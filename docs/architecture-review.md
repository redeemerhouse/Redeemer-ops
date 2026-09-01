# ONEsource Recovery Operations Architecture Review

**Review date:** 2026-09-01  
**Review basis:** Current checked-in source after the production-launch and access-control work
already merged into this branch.  
**Scope:** Recovery Housing Operations web app, Express API, middleware, authentication and
authorization, PostgreSQL/Drizzle access, OpenAPI/generated libraries, integrations, workspace
packaging, build, and Replit artifact release path.  
**Out of scope:** Product redesign, schema changes, migrations, new integrations, identity-policy
changes, route rewrites, load testing, and speculative cleanup.

## Architecture Map

### Product and frontend boundary

The deployable product is the `artifacts/recovery-housing-operations` Vite/React artifact. Its
entry point is `src/main.tsx`, which installs the top-level React error boundary and renders
`App.tsx`. `App.tsx` owns the TanStack Query client, the authentication provider, the Wouter
route tree, and the route-level error boundary. The browser routes are a dashboard, resident
list/detail, payments, assessments, assessment library, and operations workspace.

The browser calls the API with relative `/api` paths through
`lib/api-client-react/src/custom-fetch.ts` and the small domain helpers in the web artifact.
TanStack Query owns request caching and invalidation. The browser is a presentation and cache
boundary only: it does not establish identity, house scope, ownership, payment authority, or
document access. The UI role checks in `src/pages/operations.tsx` improve usability but do not
replace server checks.

### API process and routing boundary

`artifacts/api-server/src/index.ts` is the process entry point. It requires `PORT`, binds the
Express app to `0.0.0.0`, and closes the listener and PostgreSQL pool on `SIGTERM`/`SIGINT`.
Startup does not seed records, run migrations, or perform startup DDL. The production start
command is therefore separate from the release migration procedure.

`src/app.ts` constructs the Express boundary in this order:

1. disables `X-Powered-By`, configures the reviewed proxy setting, and assigns correlation IDs;
2. sets security headers, request/response timeouts, and a response-size guard;
3. installs redacted `pino-http` request logging;
4. restricts browser CORS to configured origins while allowing non-browser requests without an
   `Origin`;
5. applies bounded JSON and URL-encoded parsers plus query/parameter limits;
6. mounts public liveness/readiness routes at `/api`; and
7. mounts the rate-limited application router at `/api`, followed by safe not-found and error
   handlers.

`src/routes/index.ts` applies CSRF origin checks to mutations, mounts the canonical session
router and public auth endpoints, then applies authentication at the known sensitive route
prefixes. The imported route modules cover operations, resident imports, object storage,
assessments, authentication, and the session bootstrap.

### Authentication and session boundary

Authentication is email/password in `src/routes/auth.ts`. Registration produces an unapproved
account, verification uses a single-use action token, approval and house assignment are
administrator-controlled, and password reset revokes active sessions. Login creates a signed
token tied to a PostgreSQL row in `auth_sessions` and sets the secure HttpOnly
`__Host-recovery-session` cookie.

`src/routes/session.ts` is the one session-bootstrap response path. It calls
`authenticate`, reads the server-derived principal, and validates the safe session envelope
with the generated `GetSessionResponse` schema. It does not return the cookie credential.
The account router no longer contains a competing `/auth/session` handler. The authentication
middleware checks signature, account status, verification/approval, revocation, idle expiry,
absolute expiry, and current house assignments against PostgreSQL. Signed bearer principals
without a database session remain a non-production compatibility path for integration tests;
production browser access requires the revocable database session.

The web `AuthProvider` rechecks the server session at the last confirmed idle boundary, clears
the user-scoped query cache on logout, expiry, or failed verification, and keeps any handoff
token in process memory rather than browser persistent storage.

### Authorization boundary

`src/middlewares/auth.ts` defines the roles, permission names, organization identifier, house
scope helpers, resident access checks, and `authorize` decision function. Route code obtains
the principal from response locals and uses either `requirePermission` or explicit
resource checks. Resident and payment lookups combine the resource with server-derived house
scope; inaccessible resources use the agreed not-found behavior in the relevant paths. Account
approval, deactivation, reactivation, and session revocation use administrator checks and
revoke sessions when access assignments change.

This is the enforcement boundary for identity and access. The OpenAPI document, generated
client, UI visibility, and client-supplied role or actor headers are not trusted. The
single-organization `organizationScope = sql\`TRUE\`` in the operations router is an explicit
launch tradeoff: there is one organization today, while house scope is still derived from the
principal for manager and resident access. It is not a substitute for a future tenant
predicate if the product becomes multi-organization.

### Database and persistence boundary

`lib/db` owns the PostgreSQL `Pool`, Drizzle client, schema exports, and checked-in migration
chain. The pool uses bounded connection, idle, statement, and query timeouts, production TLS
requirements, and explicit pool sizing settings. Current schema modules cover residents,
payments, operations/applications/documents/audit events, financial records, meetings,
retention, authentication, and rate-limit buckets.

The database is authoritative for operational records, account/session state, audit history,
and relationships. API startup only opens the service; `db:release-check` and the checked-in
Drizzle migration command are the release schema path. Binary document bytes remain in object
storage, with document metadata and access relationships in PostgreSQL. Exports are generated
by the API and delivered as downloads rather than stored in browser persistence.

### Contract and code-generation boundary

`lib/api-spec/openapi.yaml` is the intended external contract. It defines the `/api` server,
health/readiness, authentication requirement, documented resident/payment/dashboard/activity
operations, reports, and generated schemas. Orval produces the React Query client and Zod
artifacts in `lib/api-client-react/src/generated` and `lib/api-zod/src/generated`.
`pnpm run codegen:check` regenerates them and fails on a dirty generated diff.

Generated types and Zod schemas are compatibility aids, not server middleware. The server
currently consumes selected generated response/request schemas while other mounted surfaces
use local route validation. The contract is therefore useful but incomplete until all exposed
operations are represented and enforced consistently.

### Integration boundary

Email delivery in `src/lib/auth-email.ts` uses the installed Resend connector through the
Replit connectors SDK. It is a degraded-service boundary: registration and recovery delivery
fail explicitly without making the API listener depend on email availability. Object storage
is similarly isolated in `src/lib/objectStorage.ts` and the storage routes; the API persists
object paths and metadata, not file bytes. QuickBooks is not implemented or part of this
release path, even though a future-facing secret name exists in the environment inventory.

### Workspace, build, and deployment boundary

The pnpm workspace contains leaf artifacts under `artifacts/*`, shared libraries under `lib/*`,
and utility scripts under `scripts`. Composite library declarations are built through the root
TypeScript solution; artifact packages are checked with their own `tsc --noEmit`.

The root build typechecks first, then builds the static web artifact with its production
`PORT`/`BASE_PATH` defaults and bundles the API with esbuild into an ESM `dist/index.mjs`.
The API build externalizes native/provider-specific modules and uses a pino build plugin.

The checked-in artifact manifests are the service-level publish contract:
`artifacts/recovery-housing-operations/.replit-artifact/artifact.toml` defines a static service
on `/` with an SPA rewrite, while `artifacts/api-server/.replit-artifact/artifact.toml` defines
a separate `/api` service whose production environment sets `PORT=8080`. The top-level
`.replit` selects the autoscale application router and does not duplicate those service paths.
Replit Publish owns the reviewed schema-application phase; the API manifest’s production run
command only starts the API.
Production configuration requires database URL, TLS, HTTPS CORS origins, a PostgreSQL rate
limit store, and a sufficiently long session secret. The current release checklist records a
no-go for the connected target because its migration ledger and limiter table are not ready.

## Stability Risks

Each finding below is classified independently. “Confirmed” means directly observable in the
current source, lockfile, tests, or release record. “Tradeoff” means intentional for the launch
scope but still requires a clear follow-up boundary.

| ID | Level | Status | Finding and evidence | Impact |
| --- | --- | --- | --- | --- |
| C1 | Critical | Confirmed | The private-pilot checklist records the connected database target as having an empty migration ledger and no `api_rate_limit_buckets` table, with an explicit **NO-GO** decision (`docs/private-pilot-release-checklist.md`, acceptance result). | The release cannot safely promote sensitive traffic until the operator-confirmed baseline/release migration procedure is complete and readiness reports both dependencies as healthy. |
| H1 | High | Confirmed | `artifacts/api-server/src/routes/operations.ts` contains the core dashboard, residents, payments, financial, meetings, houses, applications, documents, daily operations, reports, and audit-related handlers in a 1,142-line module. | A change in one domain can affect unrelated routes; review, testing, and ownership are harder, increasing the chance of authorization or response-shape regressions. |
| H2 | High | Confirmed | The mounted router includes applications, documents, operations, houses, report preview, imports, storage, and assessments, while `openapi.yaml` and generated clients do not describe every mounted operation. | A new client can miss the real API, and contract drift can hide missing validation or error behavior. This is release risk, not evidence that generated code protects a route. |
| H3 | High | Confirmed | Authorization is server-side, but enforcement is mixed between `requirePermission` and route-local checks; request/response handling in the large operations router also mixes generated schemas with local/raw objects. | Future route edits need multiple patterns and can accidentally omit one required check or return more fields than the role-shaped policy allows. |
| H4 | High | Confirmed | Several operations perform multiple independent reads and in-memory aggregation in the route module; the route also exposes broad organization-wide administrator queries. | Query cost and consistency are difficult to reason about as data grows. This is deferred because repository extraction or transaction redesign would be a higher-risk behavior change. |
| H5 | High | Tradeoff | The one-organization launch uses an explicit `sql\`TRUE\`` organization predicate while house/resource scope remains principal-derived. | This is valid for the approved single-organization launch, but it must not be copied into a future multi-organization model without a tenant predicate on every read, write, and aggregate. |
| M1 | Medium | Confirmed | `lib/db/src/index.ts` validates production TLS and supplies timeout/pool defaults, but the pool tuning inputs are not independently range-validated in the database module. | A malformed deployment tuning value can fail at process startup or produce an unsuitable pool configuration; this is operational hardening, not a reason to redesign persistence here. |
| M2 | Medium | Confirmed | The API build emits linked source maps (`artifacts/api-server/build.mjs`), and the release review does not itself prove whether the deployment serves them publicly. | Source maps can disclose implementation details if exposed by the deployment. Verify serving policy before production; do not change build output speculatively in this audit. |
| M3 | Medium | Confirmed | The frontend operations page uses broad `any` types for API data and keeps multiple report/import/document flows together; the dashboard also contains several `as any` mutation casts. | Compile-time protection is weaker at the UI/API boundary and refactors are more error-prone. New contract coverage and focused decomposition are safer follow-up work. |
| M4 | Medium | Confirmed | The generated contract includes security metadata and a drift check, but the server does not uniformly consume generated request/response validators for every mounted route. | Contract correctness can drift from runtime enforcement; sensitive route work must continue to add server-side validation and authorization tests. |
| L1 | Low | Fixed | `LegacyReports` was an unreachable duplicate of the active report component in `operations.tsx`. | Removed with no route or response change; the active report implementation remains the only report UI. |
| L2 | Low | Fixed | `docs/private-pilot-release-checklist.md` contained the same incident-response section twice. | Removed duplicated runbook text without changing release instructions. |
| L3 | Low | Fixed | The root package used `^0.4.1` and the API package used `latest` for the connectors SDK while the lockfile resolved different versions. | Both declarations now pin the existing compatible lockfile version `0.4.3`, eliminating resolver drift and the extra old lockfile entry. |
| L4 | Low | Fixed | `ApplicationModal` set its busy flag before an awaited request but had no catch/finally path, so a rejected application request could leave the control stuck and provide no recovery message. | The request now shows a generic safe error, preserves the form for retry, and always clears the busy state. |

No Critical or High code cleanup was attempted in this task. C1 is a release decision, and H1–H5
require broader route, contract, data-access, or deployment work that could alter behavior.

## Technical Debt

### Concentration and duplication

- The operations API is the primary concentration point at 1,142 lines and owns many unrelated
  data access and response-shaping responsibilities. Authentication is also a 551-line module
  containing account workflows, tokens, email triggers, and administrator account actions.
- The operations web page is a 212-line multi-workflow page after removing the dead report copy
  and expanding the application failure path for clarity;
  dashboard remains a 556-line page with several mutation flows.
- The duplicate session response path was removed before this review’s bounded cleanup. The
  canonical session router is now mounted once and is covered by a regression test.
- Generated outputs are intentionally duplicated representations of the OpenAPI source. They
  are not hand-maintenance debt, provided the code-generation drift check remains mandatory.

### Fragile dependency and release paths

- The connectors SDK had two direct declarations with floating ranges/`latest` and two lockfile
  versions. Both direct declarations now use the resolved compatible version `0.4.3`; the
  lockfile retains its integrity record and no old SDK entry.
- The API bundle externalizes many optional/native/provider packages. This keeps the bundle
  buildable, but each externalized runtime import must remain installed by the owning package.
  No externalization list was changed because that would affect deployment behavior.
- Web and API are separate artifacts joined by the shared `/api` proxy path. Relative browser
  URLs and the artifact TOMLs agree today; a future custom base path needs a matching route and
  browser-path review.
- The release path correctly separates publish-time migration from API startup, but the
  connected database remains an operator prerequisite rather than something application code
  can safely repair.

### Security and data guarantees

- Enforced guarantees are currently distributed across the Express middleware stack,
  authentication/session middleware, route-local authorization checks, Drizzle relationships,
  database constraints, and the object-storage access path. The browser and generated
  artifacts provide no security guarantee.
- Database-backed session revocation and current assignment lookup protect production browser
  access. Password reset, logout, deactivation, and administrator reassignment revoke or
  invalidate sessions as appropriate.
- CORS, CSRF origin checks, request limits, response limits, rate limits, safe errors,
  correlation IDs, and security headers are present in middleware. Their production effect
  still depends on the documented deployment settings and a healthy shared limiter table.
- Audit writes and redacted request logging exist for the current implementation, but complete
  route coverage, log sink retention/access, and production backup/restore evidence remain
  operational validation items rather than assumptions.

## Recommended Priorities

### 1. Complete the release prerequisite (Critical, operator-owned)

Follow `docs/database-baseline.md` and `docs/private-pilot-release-checklist.md` for the exact
connected target. Confirm backup/recovery, determine legacy versus fresh state, apply the
reviewed migration path, verify the migration ledger and rate-limit table, rerun
`pnpm run release:verify`, and require `/api/readyz` to report both dependencies as `ok`.
Do not add startup DDL, schema push, or manual ledger edits.

### 2. Finish the API contract and enforcement matrix (High, downstream access/API work)

Treat every mounted non-health route as a first-class contract. Add the missing OpenAPI
operations, stable error responses, bounded inputs, role-shaped outputs, and server-side
validation before exposing additional sensitive fields. Keep generated output regeneration in
the release gate and test horizontal/vertical access independently of browser visibility.

### 3. Reduce route concentration without changing behavior (High, deferred structural work)

Characterize each operations route’s payload, authorization, query scope, audit event, and
transaction boundary first. Then move one bounded domain at a time into service/data-access
modules. Preserve the current response payloads and use characterization tests to prevent
scope or money-rule drift. Do not perform this broad extraction as part of a reliability patch.

### 4. Make database and integration readiness observable (Medium)

Range-validate optional pool tuning, verify the deployment’s source-map serving policy, and
record connector/object-storage degradation without placing those services on the core
listener’s startup path. Keep PostgreSQL as the operational system of record and keep binary
storage and email as explicit provider boundaries.

### 5. Continue focused regression coverage (Medium)

Extend API/security coverage as routes become contract-complete, and add browser checks for
session bootstrap, report downloads, application-save failure recovery, and sensitive cache
clearing. The current audit adds source-level guards for the low-risk cleanup; browser coverage
should be added by the dedicated browser and critical-workflow testing work rather than by
loosening server controls.

## Applied Fixes and Validation Record

### Applied in this review

- Removed the unreachable `LegacyReports` implementation while retaining the active report
  flow and its response/download behavior.
- Kept the already-consolidated canonical `/auth/session` route and added a guard that prevents
  a second account-router implementation from returning a different contract.
- Pinned both connectors SDK declarations to the existing integrity-locked `0.4.3` version and
  removed the unused old lockfile entry.
- Removed the duplicated incident-response runbook section.
- Added a generic recoverable application-submit error and a `finally` busy-state cleanup path.
- Added `artifacts/api-server/test/architecture-cleanup.test.mjs` and the package script
  `test:architecture` to guard the bounded changes.
- Corrected the stale report regression assertion so its “records the actor” test verifies the
  signed development-test actor is present, matching the server’s audited export behavior.

### Validation

Validation completed on 2026-09-01:

- focused cleanup suite: 5/5 passed;
- OpenAPI/Orval generation and generated-diff check: passed;
- complete workspace type check: passed;
- production web and API build: passed (the web build retained its existing large-chunk and
  third-party sourcemap-reporting warnings);
- authorization: 4/4 passed;
- security controls: 4/4 passed;
- report exports and audit evidence: 17/17 passed;
- document sharing: 3/3 passed;
- overview metrics and access: 2/2 passed;
- assessment lifecycle and scope: 4/4 passed;
- retention policy: 7/7 passed;
- shared rate-limit outage/readiness behavior: 5/5 passed; and
- focused Playwright browser pass: passed using network interception and no persistent writes.
  A rejected `POST /api/applications` left the modal open, preserved every entered value,
  displayed the exact safe retry message, returned the submit control to its enabled state,
  and produced no uncaught page error or workflow crash. The only console error was the
  expected intercepted HTTP 500.

The release checklist’s connected-database failure is intentionally not bypassed by this
review. A skipped database release check is evidence of an unready target, not a successful
release.