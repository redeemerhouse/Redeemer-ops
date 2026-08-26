# ONEsource Recovery Operations

ONEsource gives Redeemer House teams a dependable workspace for resident intake, housing operations, documents, payments, and reporting.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

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
- Pilot seed data only initializes an empty houses table and never overwrites operational records.
- `SECURITY_OPERATING_MODEL.md` is the approved source of truth for identity, roles, house
  scope, resident lifecycle, documents, payments, exports, notifications, retention, and
  deletion. Sensitive route work must reference it and enforce policy server-side.

## Product

Staff can review residents and payment status, record payments, manage applications, view four-house capacity, review daily operations, and inspect an administrator reporting snapshot. Core records persist in PostgreSQL and mutations are auditable.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Run `pnpm --filter @workspace/db run push` after schema changes, then `pnpm run typecheck` and restart managed workflows.
- Run `pnpm --filter @workspace/api-server run test:retention` for the focused 15-day quarantine/legal-hold policy checks.
- Vite builds require the workflow-injected `PORT`; use the artifact workflow or provide `PORT` and `BASE_PATH` for a standalone build.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
