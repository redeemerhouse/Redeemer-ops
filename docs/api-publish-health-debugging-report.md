# API publish health debugging report

## Failure map and verified cause

The restart-loop path was:

1. Replit requested the configured startup probe at `GET /api/healthz`.
2. Express applied request IDs, security headers, timeouts, logging, CORS, body and parameter
   limits.
3. The global `/api` rate limiter attempted to increment `api_rate_limit_buckets`.
4. When PostgreSQL-backed request protection was unavailable, the limiter returned the safe
   `503` maintenance response before the health router ran.
5. Replit treated that dependency failure as a dead process and eventually sent `SIGTERM`.

The liveness failure was therefore a middleware-ordering defect: a process-liveness probe
depended on the shared request-protection store. The captured outage simulation classifies the
first store error as `connectivity`; logs include only the dependency, category, error type, and
correlation ID. They do not include the connection string, credentials, SQL, tokens, client data,
or the provider error message.

The checked-in migration `0007_sour_jigsaw.sql` creates `api_rate_limit_buckets`. The reviewed
`db:release-check` path validates the migration ledger and complete catalog before traffic is
allowed. Startup does not run DDL, schema push, migration, baseline, or seed work.

## Corrected health boundaries

- `GET /api/healthz` is public process liveness. It runs before dependency-backed rate limiting,
  authentication, sessions, CSRF, and business routers. It returns `200` and
  `{ "status": "ok" }` while the Node process can serve HTTP.
- `GET /api/readyz` is public dependency readiness. It independently checks PostgreSQL and the
  shared rate-limit table plus the current role's `SELECT`, `INSERT`, `UPDATE`, and `DELETE`
  privileges.
  It returns `200` only when both dependencies are ready.
- Readiness checks are coalesced and briefly cached in-process. Probe bursts therefore share one
  bounded dependency check and one categorized failure log rather than multiplying pool queries
  during an outage.
- A readiness failure returns a non-sensitive `503` with only `ok` or `unavailable` dependency
  states. It never substitutes for liveness.
- Authentication and business routes remain behind the shared limiter. In production they fail
  closed with the existing maintenance response during an outage and retry after the bounded
  cooldown, so recovery does not require a process restart.
- The artifact startup probe remains `/api/healthz`; operators and traffic-routing checks use
  `/api/readyz`.

## Production environment audit

The audit records names and behavior only. Values must remain in Replit deployment settings or
managed secrets.

| Setting | Role | Missing or unsafe behavior |
| --- | --- | --- |
| `NODE_ENV=production` | Enables production validation, fail-closed request protection, and TLS policy. | Without it, the process is not a production-equivalent release candidate. |
| `PORT` | Supplies the listener port; the API binds it on `0.0.0.0`. | Startup throws before listening. |
| `DATABASE_URL` | Selects the intended PostgreSQL target for application, session, and limiter state. | Production configuration throws before listening; the value is never logged. |
| `DB_SSL=true` (or `sslmode=require`) | Requires encrypted PostgreSQL transport. | Production configuration throws before listening when neither form is present. |
| `SESSION_SECRET` | Signs authenticated access and session material; minimum 32 characters. | Production configuration throws before listening when missing or short. |
| `CORS_ORIGINS` | Lists approved HTTPS browser origins. | Production configuration throws before listening when empty, invalid, or non-HTTPS. |
| `API_RATE_LIMIT_STORE=postgres` | Requires the shared multi-instance protection store. | Production configuration throws before listening for missing, invalid, or memory values. |
| `TRUST_PROXY=true` | Trusts the single Replit proxy hop so client-based controls use the forwarded address. | The API still starts, but the deployment is not topology-equivalent and must not be promoted. |

The release workflow must also prove the intended target has a compatible Drizzle ledger and the
`api_rate_limit_buckets` table. Connectivity, TLS, permissions, migration, configuration, and
unknown failures are logged as categories without raw provider details.

## Security and data impact

The change does not alter authorization, CSRF, session revocation, CORS, TLS, migration safety,
business schema, or recovery-housing data. Only the two operational probe routes bypass the
shared limiter; neither accepts credentials or returns application data. Protected routes remain
fail closed when request protection is unavailable.

## Acceptance record

Recorded on 2026-09-01:

- `pnpm install --frozen-lockfile`: **PASS**.
- Workspace typecheck: **PASS**.
- API production build and web production build: **PASS**.
- Rate-limit/readiness regression suite: **PASS**, 5 tests including a 20-request concurrent
  cold-cache readiness burst.
- Security release gate: **PASS**, 24/24 checks.
- Managed development workflow: **PASS** for five repeated liveness probes, healthy readiness,
  unauthenticated protected-route `401`, sustained uptime, and homepage delivery.
- Browser acceptance: **PASS** for the Redeemer House sign-in page, liveness, readiness, and
  protected-route boundary.
- Production-mode missing-dependency run: **PASS** for five repeated liveness `200` responses,
  readiness `503` with only `rateLimitStore: unavailable`, protected-route maintenance `503`,
  sustained uptime, and a redacted `migration` log category.
- Simulated outage and recovery: **PASS** for liveness `200`, readiness `503` then `200`, protected
  route `503` then normal `401`, and recovery without process restart.
- Graceful `SIGTERM`: **PASS**, exit status `0` with listener and pool shutdown inside the
  ten-second deadline.
- Connected database prerequisite audit: **FAIL** for release promotion. Connectivity succeeds,
  but `api_rate_limit_buckets` is absent and the configured Drizzle ledger has zero entries.
  `db:release-check` correctly stops before migration because that ledger state is not a trusted
  checked-in prefix.

## Deployment-ready decision

**NO-GO for the currently connected database target.** The application change is ready, but the
database must first complete the documented operator-confirmed baseline/release procedure and the
reviewed migration path must create `api_rate_limit_buckets`. No startup DDL, schema push, manual
ledger entry, or hard-coded credential workaround was used. After that prerequisite is repaired,
rerun `pnpm run release:verify` and require `/api/readyz` to return both dependencies `ok` before
promotion.