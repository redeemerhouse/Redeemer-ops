# ONEsource Recovery Operations

ONEsource gives Redeemer House teams a dependable workspace for resident intake, housing operations, documents, payments, and reporting.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build the deployable Recovery Housing Operations web app and API; the development-only Canvas artifact is excluded
- `pnpm run build:production` — build only the web and API production artifacts without repeating typecheck
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run generate` — generate a reviewed SQL migration after schema changes
- `pnpm --filter @workspace/db run migrate` — apply checked-in migrations non-interactively
- `pnpm run db:baseline -- --target <host:port/database> --backup-confirmed --recovery-confirmed` — one-time, verified baseline for a legacy schema-push database; never use for a fresh database
- `pnpm run db:release-check` — validate the development migration journal and catalog before publishing (requires `DATABASE_URL`)
- Replit Publish owns production schema application. API startup only starts the server and never migrates or seeds data.
- Required production configuration: `DATABASE_URL` and `SESSION_SECRET` are managed secrets; `DB_SSL=true`, `CORS_ORIGINS`, and `API_RATE_LIMIT_STORE=postgres` are ordinary deployment settings.
- Production startup rejects missing/unsafe configuration with a non-sensitive message. `CORS_ORIGINS` must be an HTTPS origin for the same private-pilot web app.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/db/src/schema/` — persistent resident, payment, house, application, document, operations, and audit models
- `artifacts/api-server/src/routes/operations.ts` — core operations API
- `artifacts/api-server/src/lib/retention.ts` — server-only deletion quarantine, legal-hold, and restore procedures
- `artifacts/recovery-housing-operations/src/pages/operations.tsx` — staff operations workspace

## Architecture decisions

- Calendar dates use PostgreSQL `date`; timestamps are reserved for audit and event history.
- Numeric payment values are converted at the API boundary before responses reach the UI.
- Pilot seed data is available only as an intentional development/operator action; it is never called by API startup or a production release.
- `SECURITY_OPERATING_MODEL.md` is the approved source of truth for identity, roles, house
  scope, resident lifecycle, documents, payments, exports, notifications, retention, and
  deletion. Sensitive route work must reference it and enforce policy server-side.

## Product

Staff can review residents and payment status, record payments, manage applications, view four-house capacity, review daily operations, and inspect an administrator reporting snapshot. Core records persist in PostgreSQL and mutations are auditable.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Generate and review a migration after schema changes, then run `pnpm --filter @workspace/db run migrate`, `pnpm run typecheck`, and restart managed workflows.
- Run `pnpm --filter @workspace/api-server run test:retention` for the focused 15-day quarantine/legal-hold policy checks.
- Vite development and preview servers require their workflow-injected `PORT` and `BASE_PATH`. Production builds use the artifact-safe defaults (`24336`/`/` for Recovery Housing Operations and `8081`/`/__mockup` for Canvas), while Canvas has no production service.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
