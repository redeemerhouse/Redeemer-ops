# API publish health debugging report

## Captured failure

The supplied Publish log shows the artifact process was launched with:

```text
pnpm --filter @workspace/api-server run start:release
```

That obsolete wrapper ran `pnpm --filter @workspace/scripts run db:release-check` before
starting the server. The database release check correctly detected an existing database without
the checked-in Drizzle ledger and stopped for the documented, operator-confirmed baseline
procedure. Replit therefore never observed port 8080, continued reporting secondary `/api`
router health errors, and terminated the artifact at the startup timeout.

The first API-process failure occurred **before listening**. It was not a port-binding error,
runtime dependency failure, or `/api/healthz` route mismatch. A production build followed by the
plain production start command logged `Server listening` on port 8080, and
`GET /api/healthz` returned `200` with `{ "status": "ok" }`.

## Root cause and minimum correction

Database release work had been coupled to the long-running API start command. That violates the
deployment contract: Replit Publish owns the reviewed development-to-production schema
application phase, while API startup must only initialize configuration, routes, security
controls, the listener, and graceful shutdown.

The minimum correction is:

1. the artifact production command runs `pnpm --filter @workspace/api-server run start`;
2. the obsolete `start:release` package script is absent;
3. database release verification remains available as the separate `pnpm run db:release-check`
   gate;
4. the API binds the Replit-supplied `PORT` explicitly on `0.0.0.0`;
5. the startup probe remains `/api/healthz`, the actual public health route.

No configuration validation, TLS, CORS, session-secret, authorization, shared PostgreSQL
rate-limit, migration, or seed safeguard was weakened.

## Readiness and safety result

- Production configuration still fails before listening with a clear setting name when
  `DATABASE_URL`, `SESSION_SECRET`, `DB_SSL`, `CORS_ORIGINS`, or
  `API_RATE_LIMIT_STORE=postgres` is missing or unsafe. Values are not logged.
- `/api/healthz` passes through the configured shared rate-limit store. A database or protection
  store outage produces the existing safe maintenance response instead of a false-ready result.
- The production start script contains no migration, schema-push, baseline, or seed command.
- Authentication and major API routers initialize during application import. An unauthenticated
  request to `/api/residents` returns `401`; forged identity headers are not startup inputs.
- `SIGTERM` closes the HTTP listener and PostgreSQL pool under the existing ten-second deadline.

## Functional and data risk

The correction does not alter API responses, authorization, database schema, or business data.
It moves database release validation back to its intended pre-publish phase. The operational risk
is limited to publishing against a database that skipped the separate release gate; operators
must continue to run the documented release verification and confirm Publish applies the reviewed
schema diff before allowing traffic.