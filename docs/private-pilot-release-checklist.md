# Private pilot release checklist

This checklist is the release boundary for the Redeemer House private pilot. Do not enter
client data until every required step is complete and the final smoke test is successful.

## 1. Backup and target

1. Confirm the intended production database target from the managed deployment configuration.
2. Take or verify a restorable encrypted backup for that exact target and record the recovery
   point in the operator log.
3. Confirm whether the target is fresh or already has the checked-in Drizzle ledger. A legacy
   schema-push database must use the reviewed `pnpm run db:baseline` procedure first; never
   use schema push to repair it.
   The current development target is intentionally in this legacy state, so it is not a
   production-publish target until that operator-confirmed baseline is complete.

## 2. Configuration

Configure ordinary environment values in the deployment settings:

- `NODE_ENV=production`
- `PORT` (the artifact supplies the service port)
- `DB_SSL=true` (requires certificate verification through the runtime's trusted CA store)
- `CORS_ORIGINS=https://<the-private-pilot-web-origin>`
- `API_RATE_LIMIT_STORE=postgres`
- `TRUST_PROXY=true`

Configure these as managed secrets, without putting their values in source control or logs:

- `DATABASE_URL`
- `SESSION_SECRET` (at least 32 characters)

The API refuses to start if the database URL, TLS posture, session secret, rate-limit store,
or HTTPS CORS origin is missing or unsafe. Startup messages name the missing setting but never
include its value. `TRUST_PROXY=true` is required by the approved one-proxy deployment topology;
an unset value does not stop startup, so the release audit must reject it explicitly.


### Component environment matrix

| Component | Setting | Classification | Failure behavior |
| --- | --- | --- | --- |
| API | `PORT`, `NODE_ENV`, `DB_SSL`, `CORS_ORIGINS`, `API_RATE_LIMIT_STORE`, `DATABASE_URL`, `SESSION_SECRET` | Required | Startup fails closed before listening when absent or unsafe. |
| API | `TRUST_PROXY` | Required for the reviewed Replit topology | Secure origin and client-address handling no longer matches the production proxy when omitted. |
| API | `DB_POOL_*`, `DB_*_TIMEOUT_MS`, `API_*_LIMIT*`, `API_REQUEST_TIMEOUT_MS` | Optional tuning | Reviewed bounded defaults apply. |
| Web build | `PORT`, `BASE_PATH` | Required by the artifact; build defaults are `24336` and `/` | Development/preview startup fails clearly if omitted; the production artifact supplies both. |
| Object storage routes | `PRIVATE_OBJECT_DIR`; Replit object-storage sidecar | Degraded service | API startup and non-document routes remain available; storage requests fail explicitly. |
| Email delivery | Resend connection/environment | Degraded service | API startup remains available; verification/reset delivery fails without exposing tokens. |
| QuickBooks | `QUICKBOOKS_API_KEY` | Optional, feature not launched | No startup dependency in the current private-pilot API. |
| Connector-backed services | `CONNECTORS_HOSTNAME` / `REPLIT_CONNECTORS_HOSTNAME` | Degraded service where used | Core database/auth startup remains independent; connector calls fail explicitly. |

## 3. Release and migration

1. Run `pnpm run release:verify` after configuring `DATABASE_URL`. This is the complete
   pre-publish gate: it runs `codegen:check`, the deployable production builds, the database
   release check, and the security release gate.
2. If a phase needs to be isolated, use the same commands used by the root build:
   `PORT=24336 BASE_PATH=/ pnpm --filter @workspace/recovery-housing-operations run build`
   and `NODE_ENV=production pnpm --filter @workspace/api-server run build`. These commands
   build the web and API artifacts only; the development-only Canvas preview is not a
   production service.
3. Confirm the Publish flow applies the reviewed development-to-production schema diff.
   The API production start command only starts the server; it must not run migrations or
   perform startup-time DDL.
4. Confirm publish configuration contains no `drizzle-kit push` or `push-force` command.
5. Confirm API startup creates no seed houses, residents, payments, operations, or templates.

If publishing fails, identify the phase before changing configuration: build failures are
reported by `pnpm run build` and name the affected artifact; schema changes are handled by the
Publish flow; startup failures come from the API process and identify missing production
configuration without printing secret values; process liveness is checked through
`/api/healthz`, while dependency readiness is checked through `/api/readyz`.

Preserve the first API process line before the repeated router health errors:

- no `Server listening` line means the failure is in configuration, release work, dependency
  loading, or database setup before port binding;
- `Server listening` followed by a passing `/api/healthz` and failing `/api/readyz` means the
  process is alive but PostgreSQL or shared request protection is not ready;
- a router error for `/api` before the process starts is secondary evidence, not the root API
  process error;
- API startup must run `pnpm --filter @workspace/api-server run start` only. Run
  `pnpm run db:release-check` as a separate release phase; never wrap it into the server start
  command.

See `docs/api-publish-health-debugging-report.md` for the captured failure and correction.

## 4. Health and smoke test

Before publish, run the production-equivalent API acceptance path from the repository root:

```sh
pnpm install --frozen-lockfile
NODE_ENV=production pnpm --filter @workspace/api-server run build
NODE_ENV=production \
  PORT=8080 \
  DB_SSL=true \
  CORS_ORIGINS=https://redeemerhouse.replit.app,https://app.redeemerhouse.com \
  API_RATE_LIMIT_STORE=postgres \
  TRUST_PROXY=true \
  pnpm --filter @workspace/api-server run start
```

Keep `DATABASE_URL` and `SESSION_SECRET` in managed secrets; do not paste them into the
command or an operator log. In a second shell, confirm the listener and public boundary:

```sh
curl --fail --silent --show-error http://127.0.0.1:8080/api/healthz
curl --fail --silent --show-error http://127.0.0.1:8080/api/readyz
curl --silent --show-error --output /dev/null --write-out '%{http_code}\n' \
  http://127.0.0.1:8080/api/residents
```

The liveness command must return `{ "status": "ok" }`. Readiness must return `200` with both
dependencies `ok`; the protected route must return `401`.
Leave the process running long enough to confirm it does not exit after initial requests, then
send `SIGTERM` and require a clean exit after the listener and PostgreSQL pool close.

After publish, verify `GET /api/healthz` repeatedly returns `200` and
`{ "status": "ok" }`, and `GET /api/readyz` returns `200` with both dependencies `ok`.
Then verify:

- a request to `/api/residents` without an approved bearer token or session cookie returns `401`;
- a forged `X-User-Role` or `X-Actor` header does not grant access;
- a house-manager token cannot read a resident or payment in another house;
- a resident token cannot open dashboard, exports, or staff-only records;
- a disallowed `Origin` receives no CORS allow header;
- security headers, `Cache-Control: no-store` problem responses, and correlation IDs exist;
- oversized bodies/query collections are rejected before route work;
- repeated requests eventually receive `429` while the shared protection store is healthy;
- a simulated unavailable shared rate-limit store returns the safe `503` maintenance response:
  `Retry-After` is present, the response has a correlation ID, and neither the protected route
  nor dependency details are exposed;
- the same outage leaves `/api/healthz` at `200`, degrades `/api/readyz` to a non-sensitive
  `503`, and after the bounded retry interval both readiness and protected-route authentication
  recover without restarting the process.

### Acceptance result record

Record the date, commit, environment, and pass/fail result without secret values or client data:

| Check | Required result | Recorded result |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | Exact lockfile install succeeds | PASS — 2026-09-01 |
| API production build | Deployable bundle succeeds | PASS — 2026-09-01 |
| Web production build | Static production build succeeds | PASS — 2026-09-01 |
| Bind supplied port on `0.0.0.0` | Listener opens and remains up | PASS — 2026-09-01 |
| Repeated `/api/healthz` | Always `200` during dependency outage | PASS — five production-mode probes |
| `/api/readyz` healthy/outage/recovery | `200` / safe `503` / `200` | PASS — managed workflow plus outage suite |
| Protected route outage/recovery | Safe maintenance `503`, then normal `401` without restart | PASS — outage suite |
| Database and migration prerequisites | Connectivity, compatible ledger, and limiter table confirmed | **FAIL** — connected target has an empty ledger and no limiter table |
| Web homepage | Published entry page returns successfully | PASS — HTTP and browser acceptance |
| Sustained uptime | Process remains running after probes and smoke checks | PASS — 2026-09-01 |
| Graceful `SIGTERM` | Listener and pool close within ten seconds; exit `0` | PASS — exit `0` |

**2026-09-01 decision: NO-GO for the connected target.** Complete the documented
operator-confirmed baseline/release migration procedure, rerun the full release gate, and require
both readiness dependencies to report `ok` before promotion. Do not use startup DDL, schema push,
or manual migration-ledger edits as a shortcut.

Use synthetic IDs and non-client test data for smoke tests. Never paste secrets, tokens, raw
responses, resident notes, payment values, or document contents into the operator log.

## 5. Shutdown and rollback

1. Stop the release candidate with `SIGTERM` and confirm the API closes its listener and
   PostgreSQL pool before the ten-second shutdown deadline.
2. If application behavior must be rolled back, deploy the last compatible application build
   without reversing a schema migration.
3. If schema recovery is required, stop writes and use an approved restore/PITR or a reviewed
   forward migration after reconciling writes. Do not drop tables or delete operational data.


## 6. Disposable recovery drill

Run the recovery drill before the private pilot and after changing the migration, backup, restore,
or shutdown procedure:

```sh
pnpm run test:db-release-check
```

`DATABASE_URL` must point to a non-client PostgreSQL server where the test role may create and
drop databases. PostgreSQL `pg_dump` and `pg_restore` must be available. The drill never restores
over the configured database. It creates uniquely named disposable source and restore databases,
uses synthetic `.invalid` fixture data only, and removes the databases and temporary custom-format
backup afterward.

The compatible rollback artifact is built in a detached temporary worktree from the pinned
revision `5d20712b9737ede530e00067a41181ee744bfe8e`. This is the reviewed non-seeding private-pilot
release immediately before the current candidate. A reviewed replacement can be selected with
`RECOVERY_DRILL_COMPATIBLE_REVISION`; the chosen revision must be a full commit ID that remains
available in the repository and is known to be an approved fallback. The drill records both the
current release-candidate revision and the separately built compatible revision.

The drill:

1. creates a target on a compatible checked-in migration-ledger prefix;
2. records a database recovery-point timestamp and takes a custom-format backup;
3. applies the remaining checked-in migration through `db:release-check`;
4. restores the pre-migration backup into a second empty database;
5. runs `db:release-check` on the restored prefix to reconcile it forward;
6. compares only synthetic row counts and a one-way fingerprint, then verifies the complete
   migration ledger and committed catalog snapshot;
7. builds and starts the current release-candidate revision, sends `SIGTERM`, and confirms a clean
   exit; and
8. separately checks out, installs, builds, and starts the selected compatible revision against
   the same forward-migrated schema with production-equivalent TLS, HTTPS CORS, session-secret,
   and PostgreSQL rate-limit settings; confirms health; sends `SIGTERM`; proves all business-table
   counts are unchanged; and proves the migration ledger was not reversed.

Passing output records only the recovery point, migration counts, synthetic row count, restore and
verification status, candidate and compatible revision IDs, shutdown result, and the fact that no
reverse migration was attempted. It must not print database URLs, credentials, fixture values,
resident data, or backup contents. Treat a skipped test as no evidence: provision a disposable
PostgreSQL target and rerun it.

## 7. Incident response

For unauthorized access, cross-house disclosure, payment tampering, malware bypass, export
leakage, or unsafe notifications: contain access, preserve correlation IDs and audit evidence,
notify the owner administrator, and stop the release. Do not include sensitive payloads in
incident chat or routine logs.
## 7. Incident response

For unauthorized access, cross-house disclosure, payment tampering, malware bypass, export
leakage, or unsafe notifications: contain access, preserve correlation IDs and audit evidence,
notify the owner administrator, and stop the release. Do not include sensitive payloads in
incident chat or routine logs.
