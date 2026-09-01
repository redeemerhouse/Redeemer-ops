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
- `DB_SSL=true`
- `CORS_ORIGINS=https://<the-private-pilot-web-origin>`
- `API_RATE_LIMIT_STORE=postgres`

Configure these as managed secrets, without putting their values in source control or logs:

- `DATABASE_URL`
- `SESSION_SECRET` (at least 32 characters)

The API refuses to start if the database URL, TLS posture, session secret, rate-limit store,
or HTTPS CORS origin is missing or unsafe. Startup messages name the missing setting but never
include its value.

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
configuration without printing secret values; health verification failures are checked through
`/api/healthz` after the service is listening.

## 4. Health and smoke test

After publish, verify `GET /api/healthz` returns `200` and `{ "status": "ok" }`. Then verify:

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
- after the retry window, repeat the request without restarting the API and confirm the shared
  store recovers and the protected route returns its normal unauthenticated response.

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
