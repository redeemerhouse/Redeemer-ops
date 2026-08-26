# Recovery Housing Operations — Security Architecture Review

**Review date:** 2026-08-25
**Scope:** Post-MVP merged repository state, including the mounted Recovery Operations API, PostgreSQL schema, document/report flows, and browser client.
**Out of scope:** Implementing authentication, a user-management workflow, SSO, integrations, penetration testing, dependency remediation, or asserting HIPAA, SOC 2, or other regulatory compliance.

## Executive summary

The repository contains a browser application, an Express 5 API artifact, generated OpenAPI/Zod/client packages, and PostgreSQL/Drizzle models. The production security boundary is **not** the mockup canvas, generated UI inventory, OpenAPI document, or browser form. It is the server route/middleware/database path.

The MVP is now mounted and reachable beyond health: resident, payment, application, document, daily-operations, house, dashboard, activity, report-summary, and report-export handlers are in the API router. This is a material change from the pre-MVP review: the sensitive CRUD behavior is no longer merely planned/scaffolded, but it is also **not secure for production exposure** because authentication, authorization, scoped access, comprehensive validation, and a centralized error boundary remain absent. The OpenAPI document and generated client still describe only the original subset of these operations, so contract drift is now a release risk.

No resident or payment data, secrets, tokens, or credentials are copied into this document. The repository exposes environment variable names only; secret values were not inspected.

## 1. Current architecture and data flow

### Components and entry points

| Component | Repository anchor | Current security-relevant behavior |
|---|---|---|
| Browser client | `artifacts/recovery-housing-operations/src/App.tsx`, `src/pages/{dashboard,residents,resident-detail,payments}.tsx` | Routes users to dashboard, resident list/detail, and payments screens. Uses generated React Query hooks. No authentication gate is present in the app tree. |
| Generated browser client | `lib/api-client-react/src/generated/api.ts` and `src/custom-fetch.ts` | Produces calls under `/api/*`. Supports an optional bearer-token getter, but this is a generic client capability and is not configured by the web app. It does not enforce authorization. |
| API process | `artifacts/api-server/src/index.ts` | Requires `PORT`, seeds pilot data on every startup path, then starts Express. Startup fails if seeding or listening fails. |
| Express app | `artifacts/api-server/src/app.ts` | Adds pino HTTP logging, unrestricted `cors()`, JSON/urlencoded parsers with no explicit size limit, then mounts `/api`. No security-header, auth, authorization, error, or rate-limit middleware is present. |
| API routes | `artifacts/api-server/src/routes/index.ts`, `src/routes/{health,operations}.ts` | Mounts public health plus all MVP operations. The operations router directly queries and mutates database tables; only a few legacy resident/payment/dashboard/activity responses use generated Zod parsing. |
| Database | `lib/db/src/index.ts`, `lib/db/src/schema/*.ts`, `lib/db/drizzle/` | Creates a `pg.Pool` from `DATABASE_URL` and a schema-aware Drizzle client. The merged schema covers houses, applications, documents, operations, audit events, residents, and payments. The current PostgreSQL schema is represented by a checked-in Drizzle SQL migration and journal, and `pnpm --filter @workspace/db run migrate` is the non-interactive apply path. Query, transaction, timeout, shutdown, tenant scope, and repository/service policy are not present in the reviewed API. |
| Contract/codegen | `lib/api-spec/openapi.yaml`, `lib/api-zod/src/generated/*` | OpenAPI is the intended contract source; Orval generates TypeScript client types/hooks and Zod schemas. Generation is documented in `replit.md`. Generated artifacts are not themselves route middleware. |

### Reachable versus described surfaces

**Confirmed reachable from the API router after the MVP merge:**

- `GET /api/healthz` — public, no authentication or authorization.
- `GET /api/dashboard`, `GET /api/activity` — unscoped resident/payment/audit aggregates and activity.
- `GET/POST/PATCH /api/residents` and `/api/residents/:id` — resident PII and status mutation.
- `GET/POST /api/payments` — payment amounts, dates, methods, and resident relationship.
- `GET/POST/PATCH /api/applications` and `/api/applications/:id` — intake, referral/treatment history, spiritual reflection, family information, signatures, checklists, and exception reasons.
- `GET/POST /api/documents` — document metadata, resident/application links, visibility, upload path, and status.
- `GET/POST /api/operations` — resident-linked daily-operation records, notes, and private flag.
- `GET /api/houses` — house addresses, capacity, and pricing.
- `GET /api/reports/summary` — cross-domain operational counts and payment totals.
- `GET /api/reports/:reportType/export` — CSV/PDF exports; the only route with an admin check, implemented from a client-controlled `X-User-Role` header.
- Express framework fallbacks for unmatched paths (exact response behavior is not specified by an application error handler).

**Described in the contract/generated client but not fully aligned with the mounted router:**

- `GET /api/dashboard`
- `GET/POST /api/residents`
- `GET/PATCH /api/residents/{id}`
- `GET/POST /api/payments`
- `GET /api/activity`
- `GET /api/reports/{reportType}/export` is described, but its required `X-User-Role` header is not an identity mechanism.
- Mounted `/applications`, `/documents`, `/operations`, `/houses`, and `/reports/summary` have no OpenAPI operations or generated client coverage.

This is an important release gate: a route must not be considered protected merely because it appears in `openapi.yaml`, has a generated hook, has a UI form, or contains an `X-User-Role` check.

### Post-merge security reconciliation

The merged MVP adds sensitive surfaces that must be included in the existing security work rather than treated as feature-complete controls:

| Surface | Data/access risk | Required owner and acceptance boundary |
|---|---|---|
| Applications | Intake PII, family/referral/treatment history, spiritual reflection, signature and exception fields; raw body writes currently accept arbitrary fields. | **Identity/access + API hardening owners (B1/B4):** authenticated staff/resident policy and bounded transport. **Validation owner (B2):** allowlisted application DTOs, status transitions, length and format limits. **Persistence owner (B3):** application-to-resident conversion and audit transaction rules. |
| Documents | Resident/application linkage, visibility, upload path, and status are returned to any caller; `objectPath` is metadata only and binary storage is not an API authorization boundary. | **Identity/access owner (B1):** role- and resident-scoped reads/writes. **Validation/persistence owner (B2/B3):** safe linkage, visibility/status transitions, object-path policy, and no client-controlled ownership. **Document regression owner (task 16):** tests for sharing and cross-resident access. |
| Daily operations | Resident-linked notes and `private` records are exposed by an unscoped list route. | **Identity/access owner (B1):** house/resident scope and administrator-only private records. **Logging owner (B5):** note redaction and audit minimum-data policy. |
| Houses and dashboard/activity | Addresses, capacity, pricing, resident counts, payment totals, and audit details are globally aggregated. | **Scoped-data owner (B3):** house/organization-scoped aggregates. **Dashboard test owner (task 8):** verify empty/loading/error and scoped-data states without treating visual behavior as authorization. |
| Reports | Report summary is unprotected; exports query all sensitive tables and emit roster, financial, referral, compliance, or audit data. Export audit metadata uses caller-supplied actor/header values. | **Identity/access + export owners (B1/B3/B5):** administrator authorization from authenticated identity, scoped report rows, safe response headers, and export audit actor derived server-side. **Report regression owner (task 15):** CSV/PDF route and download checks. |
| Seed/startup and schema | Startup writes pilot records; checked-in migrations now provide a repeatable schema apply path, but backup/restore and production migration rehearsal remain unverified. | **Release-verification owner (task 14):** prove startup uses the intended environment and run the checked-in migration path before production. **API hardening owner (task 13):** safe startup, pool lifecycle, and production configuration. |

The original resident/payment blockers therefore apply to the full merged route tree. No new route is launch-ready solely because it responds successfully.

## 2. Assets, actors, and trust boundaries

### Protected assets

1. **Resident PII:** names, email addresses, phone numbers, home/placement, move-in dates, status, and free-text notes.
2. **Financial/operational data:** balances, payment amounts, due/paid dates, payment status, methods, occupancy and dashboard aggregates.
3. **Relationship integrity:** the mapping between a resident, their home/organization, and their payments.
4. **Identity and session material:** future staff identities, roles, cookies, bearer tokens, CSRF state, and session metadata.
5. **Database contents and backups:** PostgreSQL records, connection credentials, pool access, migrations, and exports.
6. **Operational evidence:** audit events, request logs, error logs, traces, browser diagnostics, and backups containing any of the above.
7. **Deployment secrets:** `DATABASE_URL`, `SESSION_SECRET`, and any future provider credentials. The repository snapshot also declares `QUICKBOOKS_API_KEY`; no QuickBooks integration is assumed by this review.

### Actors

- Unauthenticated internet client, including scanners and automated abuse.
- Authenticated staff member (future; role and scope are not yet defined).
- Staff member with broader operational/admin privileges (future; must not be inferred from UI visibility).
- Malicious or compromised staff account.
- API process and its database role.
- Database operator/deployment operator.
- Browser extensions, shared workstations, and third-party observability/log sinks.

### Trust boundaries

1. **Internet/browser → API:** every request, including IDs, filters, body fields, cookies, and bearer tokens, is attacker-controlled until authenticated, authorized, bounded, and validated server-side.
2. **Browser UI → generated client/contract:** untrusted presentation code. Client-side required fields and status controls are usability only.
3. **API → database:** privileged application boundary. Queries must apply tenant and resource scope on the server; the database user must not be broader than required.
4. **Application → logs/telemetry:** logs are a separate sensitive data store. Request bodies, headers, PII, payment values, tokens, and raw error payloads must not cross without an explicit redaction policy.
5. **Application → deployment environment:** environment variables and managed secrets are trusted inputs only when loaded server-side and never returned or logged.
6. **Future organization/house → organization/house:** if more than one house or organization is supported, `tenant_id`/scope must be derived from the authenticated principal and enforced in every read, write, aggregate, and relationship lookup. A client-supplied house string is not a tenant boundary.
7. **Health/public edge → protected application:** health should reveal only the minimum operational state and must not become a proxy for database or dependency details.

### Intended access surfaces

| Surface | Intended exposure | Required guarantee |
|---|---|---|
| Health | Public or private, product-owner decision | Returns minimal status; no sensitive diagnostics; availability and abuse controls are explicit. |
| Authenticated staff | Resident, payment, dashboard, activity operations | Valid identity, active session/token, least-privilege role, and server-derived organization/house scope. |
| Future admin | Account/role, tenancy, retention, exports, audit access | Separate explicit permission; step-up/re-authentication for high-impact actions; no implicit elevation from being staff. |
| Database/deployment | Operators and application service only | No browser access; scoped credentials; secrets outside source and logs. |

## 3. Contract, model, and route grill

### Confirmed gaps and risks

- **No authentication or authorization contract:** The paths in `openapi.yaml` declare no security scheme or per-operation requirements. A future route could accidentally ship public if this remains implicit.
- **IDOR/cross-scope risk:** Numeric `id` and `residentId` values are client-controlled (`openapi.yaml` parameters and `lib/api-zod/src/generated/api.ts`). Every lookup must combine identity scope and resource ID; “record exists” must not be enough.
- **Mass assignment risk:** `ResidentInput` permits `status`; `ResidentUpdate` permits `status`, but business transitions and privileges are unspecified. The database insert schema omits `balance` and `nextPaymentDate`, which is a useful boundary, but it is not currently wired to route validation. Payment input accepts client-controlled `amount`, `dueDate`, `paidDate`, and `method`; status is stored in the database model but is not an input omission policy.
- **Server-authoritative fields are not defined:** `Resident.balance`, `nextPaymentDate`, payment `status`, and response `residentName` must be derived or checked server-side. A browser must never set a balance, mark an unpaid record paid, alter ownership, or use a stale resident name as authority.
- **Weak scalar constraints:** OpenAPI uses unconstrained `number` for IDs and money, strings for dates, and free-form strings for email, phone, home, notes, and method. Generated Zod adds only a few constraints (`name.min(1)` and enums). No finite/non-negative money, integer ID, ISO date, length, normalization, email, or method policy is represented.
- **Enum/database drift:** OpenAPI and generated schemas constrain status values, while Drizzle columns are plain `text` with defaults and no database `CHECK` constraints. Direct SQL or an unreviewed route can write invalid states.
- **Nullable/optional ambiguity:** OpenAPI makes `paidDate` and `method` nullable in responses but only optional in `PaymentInput`; resident notes differ between optional string input and nullable response. Define whether omitted, empty, and null mean different things before persistence.
- **Relationship integrity is incomplete:** `payments.residentId` has a foreign key, but deletion behavior is unspecified. The API must verify resident visibility and lifecycle rules before creating a payment and define what happens to payments when a resident exits or is removed.
- **Financial representation risk:** PostgreSQL uses `numeric(10,2)`, while the API/client uses JavaScript `number`. Avoid binary floating-point calculations and rounding drift; serialize money deliberately and enforce bounds/precision.
- **Unbounded collection surfaces:** Resident/payment/activity lists have no pagination, maximum page size, sorting, or response-size contract. Search and filters have no length/complexity bounds.
- **Response overexposure:** Resident responses intentionally include direct contact data and notes, and payment responses include amounts and methods. Create role-specific response DTOs; do not return database rows by default. Dashboard/activity may leak cross-scope aggregates or sensitive detail if not scoped and redacted.
- **Error behavior is undefined:** The contract lacks standard `400/401/403/409/429/500` response schemas for most operations. There is no application error middleware. Avoid stack traces, SQL details, existence oracles, and raw validation internals in production responses.
- **Contract is not enforcement:** `lib/api-zod` exports runtime schemas, but route code currently uses only `HealthCheckResponse.parse`. The generated schemas should be consumed by shared request/response middleware or service boundaries, not copied/adapted ad hoc in each route.

### Required source-of-truth rule

Use this order and make drift testable:

1. **OpenAPI** defines the external operation, security requirements, parameter/body/response shape, limits, and documented error statuses.
2. **Code generation** regenerates TypeScript client types and Zod schemas; generated files are never hand-edited.
3. **Server route middleware** selects the generated Zod schema (or a deliberately shared server schema derived from the same source) for params, query, body, and response validation.
4. **Authorization policy module** is the single server-side source of role/action/scope decisions. UI visibility, OpenAPI alone, and database defaults are not authorization.
5. **Database schema/constraints** enforce invariants that must remain true even if another code path writes data; service logic enforces context-dependent business rules.

Add CI checks that regenerate code and fail on a dirty diff, and tests proving every sensitive route has authentication, authorization, validation, scoped queries, and safe error mapping.

## 4. Operational controls

| Control | Finding | Required direction |
|---|---|---|
| Authentication | **Confirmed absent** from app, API, contract security metadata, and route tree. | Add authentication before exposing any sensitive route; reject missing/invalid credentials with uniform `401`. |
| Authorization | **Confirmed absent.** No roles, tenant/house scope, or resource policy exists. | Central policy + scoped data-access functions; uniform `403`/not-found behavior as appropriate. |
| CORS | **Confirmed broad:** `app.use(cors())` in `artifacts/api-server/src/app.ts`. | Allow only the deployed browser origin(s); decide credentialed-cookie versus bearer-token posture; never combine wildcard origin with credentials. |
| Cookies/CSRF | **Cannot fully verify:** `cookie-parser` is installed but not used; no session/cookie setup or CSRF middleware is present. | Choose one documented browser auth posture. If cookies are used, use secure/httpOnly/SameSite settings, origin/CSRF protection, and proxy awareness. |
| Request limits | **Confirmed absent:** `express.json()` and `express.urlencoded({extended:true})` have no explicit limits. | Set conservative body and parameter limits; reject oversized payloads before route work; bound notes/search/filter lengths. |
| Rate limiting | **Confirmed absent.** | Rate-limit health and all future authenticated mutations/read-heavy endpoints by IP and principal, with a documented storage strategy for multiple instances. |
| Security headers | **Confirmed absent:** no Helmet or equivalent middleware. | Set headers appropriate to the deployment, including a deliberate CSP for the browser app, frame/transport/referrer/content-type policy. |
| Safe errors | **Confirmed absent:** no final error handler or problem-details mapping. | Centralize error conversion; log correlation IDs server-side; return stable non-sensitive errors and no stack/SQL/secret details. |
| Logging | `pino-http` redacts authorization, cookies, and set-cookie; request serializer removes query strings. **Not verified:** body redaction, arbitrary application logs, database values, browser `console.error`, retention, sink access, and log deletion. | Treat logs as sensitive. Never log resident fields, payment values, raw bodies, tokens, connection strings, or full error payloads; define retention/access and test redaction. |
| Database access | `Pool` is created from `DATABASE_URL` with defaults. **Not verified:** pool sizing, connect/query/idle timeouts, TLS requirements, least-privilege role, migrations, backup/restore, and graceful shutdown. | Configure bounded timeouts/pool behavior, TLS as required by environment, least-privilege DB role, migrations, and safe shutdown. |
| Production/dev separation | Development sets `NODE_ENV=development` and enables pino-pretty; production behavior is conditional. **Not verified:** deployment env, source-map exposure, debug settings, origin, and database separation. | Keep production secrets/data isolated, disable debug/pretty logs, review source-map serving, and use a production-safe configuration check. |
| Client error handling | `custom-fetch` parses server error bodies and `main.tsx` sends caught errors to `console.error`. | Ensure UI never displays/logs sensitive server error bodies; avoid token-bearing URLs; use cache policies that do not persist sensitive responses beyond the intended session. |

## 5. Relevant STRIDE threats

| STRIDE | Threat in this system | Current exposure / mitigation required |
|---|---|---|
| Spoofing | Attacker calls resident/payment paths as staff or steals a future session/token. | Auth is absent; add robust identity verification, session lifecycle, revocation, and secure browser storage/cookie rules. |
| Tampering | Client changes payment amount/status, resident status, ownership/home, or balance through crafted JSON. | Server-authoritative fields, allowlisted mutation DTOs, business-transition policy, database constraints, and audit events. |
| Repudiation | Staff disputes a payment or resident record change. | Immutable audit event with actor, action, target, scope, timestamp, request correlation ID, outcome, and before/after metadata that excludes unnecessary PII/payment secrets. |
| Information disclosure | Public/unscoped list or detail reveals contact details, notes, balances, payments, or cross-house aggregates; logs expose the same. | Authz/resource scope, role-based response shaping, generic not-found behavior, redaction, retention, and access controls. |
| Denial of service | Large JSON/urlencoded bodies, expensive unbounded lists/search, health floods, or DB pool exhaustion. | Parser/query limits, pagination, timeouts, rate limits, bounded concurrency, and observability. |
| Elevation of privilege | Any authenticated staff member edits records outside their house or performs admin actions; UI-only controls are bypassed. | Central policy evaluated server-side on every operation; explicit roles and tenant scope; tests for horizontal and vertical privilege escalation. |

## 6. Prioritized security backlog

The first four items are **launch blockers** for any sensitive resident/payment route. They should become separate implementation tasks; this review intentionally does not implement them.

### Blocker B1 — Identity, session, and authorization boundary

- **Guarantee:** Every non-health operation requires an authenticated principal and a server-side role plus organization/house/resource-scope decision.
- **Affected surface:** All described dashboard, activity, resident, and payment routes; future admin routes.
- **Abuse case:** An unauthenticated caller, or a valid staff user changing `{id}`/`residentId`, reads or mutates another resident or house.
- **Acceptance criteria:** Contract security requirements are present for every sensitive operation; missing/invalid auth returns `401`; insufficient role/scope returns a documented `403` or indistinguishable `404`; tests cover horizontal and vertical access; no client-provided tenant field can widen scope.

### Blocker B2 — Server-side validation and authoritative mutation rules

- **Guarantee:** Every request is validated at the API boundary and every response is shaped/validated; only allowlisted fields can mutate; balances, payment status, ownership, names, and derived dates follow server rules.
- **Affected surface:** Resident and payment inputs, filters, IDs, responses, database writes.
- **Abuse case:** Crafted JSON uses negative/NaN/over-precision amounts, invalid dates/enums, oversized notes, mass-assignment fields, or marks an unpaid payment paid.
- **Acceptance criteria:** Invalid params/query/body produce stable `400` problem responses; unknown fields are rejected or explicitly stripped; money/IDs/dates/lengths have bounded schemas; payment and resident invariants are tested; generated code is regenerated from the contract with no manual drift.

### Blocker B3 — Scoped data access and database invariants

- **Guarantee:** Every query and aggregate is scoped by authenticated organization/house and resource relationship; database constraints preserve valid references and states.
- **Affected surface:** Lists, detail lookups, dashboard/activity aggregates, payment creation, future updates/deletes.
- **Abuse case:** An IDOR or `residentId` substitution crosses houses; a payment is attached to an inaccessible resident; an invalid status enters through a secondary path.
- **Acceptance criteria:** Data-access tests prove no cross-scope rows/counts; resident/payment writes are transactional where needed; DB constraints cover status, amount, and relationship rules; deletion/exit behavior is explicitly tested; DB role cannot perform unrelated administrative operations.

### Blocker B4 — Safe transport and error boundary

- **Guarantee:** Sensitive traffic is origin-restricted and protected by the chosen cookie/token posture; requests are bounded; errors reveal no secrets or internals.
- **Affected surface:** `artifacts/api-server/src/app.ts`, all API responses, browser client, deployment configuration.
- **Abuse case:** Cross-origin credential abuse/CSRF, body-size DoS, rate abuse, or a 500 response/log exposing SQL, stack, PII, or tokens.
- **Acceptance criteria:** Allowed/disallowed origin and credential tests pass; cookie auth has CSRF tests if selected; parser and route limits return `413`/`400` safely; rate-limit behavior is tested; security headers are asserted; production errors contain a correlation ID but no stack/SQL/secret.

### Blocker B5 — Auditability and sensitive-data handling policy

- **Guarantee:** High-impact reads/writes are attributable, and logs/audits contain the minimum data needed for operations.
- **Affected surface:** Resident/payment mutations and reads, `pino-http`, application errors, audit storage/export.
- **Abuse case:** A payment is altered without an actor trail, or a log sink/back-up becomes an ungoverned copy of resident records.
- **Acceptance criteria:** Audit events cover create/update/payment/status/admin actions with actor/scope/outcome; automated redaction tests cover headers, bodies, PII, money, tokens, and errors; retention/access/deletion procedures are documented and reviewed; routine logs do not contain raw resident/payment payloads.

### Hardening H1 — Pagination, query budgets, and availability

- **Acceptance criteria:** All collection endpoints require bounded page size and stable ordering; search/filter length and DB query time are bounded; pool timeouts and rate limits are observable and tested under concurrent load.

### Hardening H2 — Contract/model consistency

- **Acceptance criteria:** OpenAPI, generated Zod/types, service DTOs, and DB constraints agree on enums, nullability, dates, money serialization, and error responses; CI fails when regeneration produces a diff.

### Hardening H3 — Production configuration and lifecycle

- **Acceptance criteria:** Production startup fails closed for missing/unsafe configuration; database TLS/timeouts/pool limits and graceful shutdown are verified; development logging/debug behavior cannot be enabled accidentally in production; deployment/source-map exposure is reviewed.

### Hardening H4 — Security testing and dependency hygiene

- **Acceptance criteria:** Add route-level tests for authz/IDOR/mass assignment/validation/errors/limits/CORS and a dependency audit in CI. This is testing and maintenance work, not a substitute for the controls above.

## 7. Product-owner decisions resolved

The product-owner decisions are approved and published in
[`SECURITY_OPERATING_MODEL.md`](SECURITY_OPERATING_MODEL.md). That document is the
implementation source of truth for the single organization/multiple-house tenancy,
`owner_admin`, `program_director`, `house_manager`, and `resident` roles; email/password
identity and session posture; resident lifecycle; household and child representation;
data visibility; documents and attendance; money rules; exports; notifications; audit;
retention; and deletion quarantine.

The following legacy contract observations remain implementation work, not unresolved
policy: the current OpenAPI status enums and report role header predate the approved
model, and must be updated as part of the relevant route/contract hardening task. No
implementation may treat those legacy fields as permission enforcement.

## 7a. Historical questions (resolved by the operating model)

These decisions must be recorded before implementing B1–B5:

1. Is the initial tenancy one house, multiple houses, or multiple organizations containing houses? Can staff belong to more than one scope?
2. Which roles exist (for example, house staff, manager, finance, system admin), and which read/write/export/audit actions does each role receive?
3. Is health public, authenticated, or restricted to deployment monitoring? What availability detail is acceptable?
4. Are payments only manually recorded operational records, or will a payment processor/accounting system be integrated later? This review assumes no external integration and no card data storage.
5. Is the authoritative money format decimal-string/API integer cents, and what currency/rounding rules apply?
6. Which resident fields may staff edit, who may change status, and what are the exit, correction, and deletion/retention rules?
7. What are retention periods and access rules for resident records, payment records, audit events, logs, exports, and backups? What deletion/legal-hold process is required?
8. Should the browser use secure session cookies or bearer tokens? If cookies, what CSRF and cross-origin deployment model is approved?
9. Are notes allowed to contain sensitive recovery/health information, and what role restrictions, redaction, and retention apply?
10. What operational SLOs and abuse thresholds define parser limits, pagination limits, rate limits, and incident response?

## 8. Recommended implementation order

1. Resolve the product decisions above and record the tenancy/role/money/retention model.
2. Establish the OpenAPI security/error/validation contract and regeneration check.
3. Implement authentication/session posture and centralized authorization policy (B1).
4. Implement validated, allowlisted service commands and server-authoritative financial/resident rules (B2).
5. Implement scoped repositories/transactions plus database constraints and safe connection lifecycle (B3).
6. Add transport hardening, limits, rate limiting, headers, and centralized error handling (B4).
7. Add audit events, redaction tests, retention/access rules, and operational dashboards (B5).
8. Add focused authorization/security tests and run dependency/static validation before exposing any sensitive route.

## 9. Post-merge release status

### Verified after the MVP merge

- The API build and all workspace typechecks completed for the API, web, mockup, and scripts packages.
- The managed API workflow rebuilt and started successfully on its configured port.
- Direct startup probes returned `200` for health plus the mounted dashboard, resident, payment, application, document, operations, house, and report-summary routes.
- `git diff --check` passes for this review.
- The database package contains a checked-in initial migration and journal for all eight current PostgreSQL tables. `pnpm --filter @workspace/db run migrate` applies pending migrations without an interactive schema diff or force push.

### Launch blockers remaining

The following remain blockers before any production exposure of sensitive routes:

1. **Identity and authorization (B1):** all MVP routes except the superficial export header check accept unauthenticated requests; the header is client-controlled and is not an identity boundary.
2. **Validation and authoritative mutations (B2):** application, document, operation, and report inputs are largely raw request bodies; resident/payment validation and server-authoritative business rules are incomplete.
3. **Scoped data access and database invariants (B3):** reads and aggregates query globally, relationship checks are incomplete, and status/financial invariants are not enforced across the expanded schema.
4. **Transport, limits, and safe errors (B4):** origin-restricted CORS, bounded parsers/query/response limits, security headers, rate limits, and a centralized production-safe error boundary are implemented. Authentication/CSRF posture and final deployment values remain with identity/access work.
5. **Audit and sensitive-data handling (B5):** high-impact route reads/writes now create minimum-data audit events with correlation IDs and seven-year retention metadata, and request/client logs avoid raw sensitive values. Authenticated actor/scope attribution and audit-store access enforcement remain with identity/access work.
6. **Release verification (H2–H4/task 14):** the expanded route inventory, contract regeneration, security tests, production configuration checks, and the database migration release check must pass as one release gate. The migration check validates the journal and runs the same non-interactive `db migrate` command used for production against a `DATABASE_URL` target. The aggregate workspace build is blocked by the mockup workflow’s required `PORT`.

Successful startup and `200` responses demonstrate merge coherence only. They are not evidence that the sensitive routes are secure. Production exposure remains prohibited until the security release-verification task passes with the blockers above either closed or explicitly accepted by the product owner.

### Migration and recovery expectations

- Schema changes are generated into `lib/db/drizzle/`, reviewed as SQL, committed with the Drizzle journal metadata, and applied with `pnpm --filter @workspace/db run migrate`. Production must not use `push`, `push --force`, or an interactive schema diff.
- Before applying a production migration, take or confirm a restorable database backup and verify the target and migration version. The release check requires `DATABASE_URL` and exercises the production apply command; it does not replace backup or restore testing.
- Migrations are forward-only release artifacts. If an application rollback is needed, first deploy the last compatible application version without reversing a schema migration. A schema rollback must use a reviewed forward-fix migration or restore/PITR to an approved recovery point after reconciling any writes made since that point; do not manually drop tables or delete resident, payment, application, document, operations, house, or audit data as a rollback mechanism.

## Validation and unresolved assumptions

- Repository paths and claims in this review were checked against the current source tree on 2026-08-25, after the MVP merge.
- The available workspace validation commands are `pnpm run typecheck` and `pnpm run build`; they are intended to be run without changing application behavior after this documentation-only review.
- This review did not inspect secret values, production deployment settings, live database contents, backups, network policy, identity provider configuration, or log sink retention. Those are explicitly unverified, not assumed secure.
- No penetration test was performed, and no regulatory compliance conclusion is made.