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

1. Run `pnpm run codegen:check`.
2. Run `pnpm run build` with the artifact-provided ports (`PORT` and `BASE_PATH`).
3. Use the API production start command, which runs `pnpm run db:release-check` before the
   server accepts traffic. It validates the journal, applies only checked-in migrations, and
   compares the target catalog with the committed snapshot.
4. Confirm publish configuration contains no `drizzle-kit push` or `push-force` command.
5. Confirm API startup creates no seed houses, residents, payments, operations, or templates.

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

## 6. Incident response

For unauthorized access, cross-house disclosure, payment tampering, malware bypass, export
leakage, or unsafe notifications: contain access, preserve correlation IDs and audit evidence,
notify the owner administrator, and stop the release. Do not include sensitive payloads in
incident chat or routine logs.