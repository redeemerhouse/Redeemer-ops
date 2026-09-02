# API RELIABILITY REPORT

Baseline published before endpoint behavior changes for the Redeemer House API.

## Scope and method

The effective API is every route mounted by `createApp()` under `/api`, after the migration guard, request protection, CSRF middleware, authentication boundary, and router ordering are applied. This report covers health, authentication/session, resident import, operations, assessments, storage, and reporting. It records source review plus the repeatable `pnpm --filter @workspace/api-server run test:reliability` evidence described below.

The audit treats the Express middleware and route/data-access implementation as the enforcement boundary. OpenAPI and generated clients describe supported public operations but do not provide authentication, authorization, or runtime response enforcement.

## Common reliability boundary

| Concern | Baseline result |
| --- | --- |
| Correlation | `requestId` accepts a bounded safe `X-Request-ID` or creates a UUID and returns `X-Correlation-ID`. |
| Authentication | Health and account bootstrap/recovery entry points are public by route design. Session validates itself. Known sensitive prefixes are authenticated at the router mount and again where required. |
| Authorization | Permission/house/resident checks are route-specific. Concealed resident/document reads generally use 404; explicit denied actions use 403. |
| Request parsing | Strict JSON and bounded URL-encoded parsing are global. Malformed JSON reaches the shared error handler as 400. Query count/size and path-segment length are bounded. |
| Error response | Shared failures and deliberate 4xx/5xx route responses are normalized to safe `application/problem+json` with `Cache-Control: no-store` and a correlation ID. |
| Unexpected dependency failure | Express 5 async rejection handling reaches the shared boundary. Logs classify the error without returning stack traces, SQL, credentials, provider responses, or sensitive values. |
| Timeout | Timeout handling exposes an abort signal, marks the request expired, and requires mutation handlers to check before writes and between multi-step writes; provider/DB cancellation of an operation already in flight remains a residual dependency capability. |
| Response validation | Health, session, dashboard, payment, finance, meeting, activity, import contract portions, and assessments have generated/runtime schemas in varying depth. Several internal operations/auth/storage responses remain ad hoc and are identified below. |
| Duplicate/concurrent requests | Resident creation and import confirmation use locking/conflict checks; token consumption and assessment publishing use conditional updates. Most ordinary creates do not accept idempotency keys, so callers must treat a lost success response as indeterminate. Database constraints/transaction atomicity remain in the database-integrity audit. |

## Endpoint matrix

Legend: **P** public, **A** authenticated, **Admin** administrator only, **HM** house-scoped staff, **R** resident-self/scoped. “Problem” means bounded problem JSON with correlation ID. All database-backed rows inherit 503-safe dependency failure behavior from the shared error boundary.

| Method and path | Identity / permission | Input and output validation | Missing / malformed / status | Side effect, timeout, duplicate risk | Evidence |
| --- | --- | --- | --- | --- | --- |
| GET `/healthz` | P | Generated response | 200 JSON | No dependency; no write | reliability + resilience |
| GET `/readyz` | P | Generated response | 200 or 503 JSON; no-store/retry hint | Coalesced cached DB/rate-store probes; no write | reliability + resilience |
| GET `/auth/session` | A | Generated response | 401 Problem; 200 no-store/private | Session lookup/touch; only one effective declaration | reliability + authorization |
| POST `/auth/bootstrap` | P + bootstrap secret | Hand validation; bounded message | 403/409 Problem, 201 | Advisory lock prevents duplicate owner bootstrap | reliability + auth lifecycle |
| POST `/auth/register` | P | Hand validation; bounded message | 400 Problem, 202 anti-enumeration | Transactional account/token/audit; normalized-email conflict concealed; retry may repeat 202 | reliability + auth lifecycle |
| POST `/auth/verification/request` | P | Safe body; bounded message | Always 202 anti-enumeration | Token replacement/email/audit; delivery failure concealed | reliability + auth lifecycle |
| POST `/auth/verify-email` | P | Token bounds; bounded message | 400 Problem, 200 | Conditional one-time token claim; duplicate is 400 | reliability + auth lifecycle |
| POST `/auth/login` | P | Credential checks; bounded principal | 401/429 Problem, 200 | Rate limited; session insert; DB/rate-store failures fail closed | reliability + auth lifecycle |
| POST `/auth/logout` | P, current token optional | No body/output | 204 | Session revocation is repeat-safe; DB failure is 503 | reliability + auth lifecycle |
| POST `/auth/password-reset/request` | P | Safe body; bounded message | Always 202 anti-enumeration | Token/email/audit; delivery failure concealed | reliability + auth lifecycle |
| POST `/auth/password-reset/complete` | P | Token/password bounds | 400 Problem, 200 | Conditional claim + password/session transaction; duplicate is 400 | reliability + auth lifecycle |
| GET `/auth/admin/accounts` | A + Admin | Ad hoc safe projection | 401/403 Problem, 200 | Read only | reliability + authorization |
| POST `/auth/admin/accounts/:id/approve` | A + Admin/owner rules | Hand body + strict positive ID | 400/403/404 Problem, 200 | Transactional assignment/session revocation; repeat updates current state | reliability + authorization |
| POST `/auth/admin/accounts/:id/deactivate` | A + Admin/owner rules | Strict positive ID | 400/403/404 Problem, 200 | Transactional deactivate/session revoke; repeat-safe | reliability + authorization |
| POST `/auth/admin/accounts/:id/reactivate` | A + Admin/owner rules | Strict positive ID | 400/403/404 Problem, 200 | Reactivate; repeat-safe | reliability + authorization |
| POST `/auth/admin/accounts/:id/sessions/revoke` | A + Admin/owner rules | Strict positive ID | 400/403/404 Problem, 200 | Bulk revoke; repeat-safe | reliability + authorization |
| GET `/dashboard` | A + dashboard read scope | Strict generated query/response | 400 Problem, 200 | Multi-query read + audit | reliability + overview |
| GET `/activity` | A + activity scope | Generated response | 403 Problem, 200 | Scoped read + audit | reliability + authorization |
| GET `/residents` | A + list scope | Strict generated query; response projection | 400 Problem, 200 | Scoped read + audit | reliability + authorization |
| POST `/residents` | A + create/house scope | Strict generated body; projected response | 400/403/409 Problem, 201 | Transaction + email advisory lock; duplicates 409 | reliability + critical workflows |
| GET `/residents/:id` | A + concealed resident scope | Generated strict positive ID; projection | 400/404 Problem, 200 | Read + audit | reliability + authorization |
| PATCH `/residents/:id` | A + concealed update scope | Generated ID/body | 400/404 Problem, 200 | Transactional update + audit; last-write-wins | reliability + critical workflows |
| GET `/payments` | A + payment read scope | Strict generated query/response | 400/403 Problem, 200 | Scoped read + audit | reliability + reports |
| POST `/payments` | A + payment create/resident scope | Strict generated body/response | 400/403/404 Problem, 201 | Transactional payment/balance/audit; no idempotency key | reliability + critical workflows |
| GET `/expenses` | A + expense read | Generated query/response | 400/403 Problem, 200 | Scoped monthly read | reliability + overview |
| POST `/expenses` | A + expense create | Generated body/response | 400/403/404 Problem, 201 | Insert; no idempotency key | reliability + overview |
| GET `/income` | A + income read | Generated query/response | 400/403 Problem, 200 | Scoped monthly read | reliability + overview |
| POST `/income` | A + income create | Generated body/response | 400/403/404 Problem, 201 | Insert; no idempotency key | reliability + overview |
| GET `/meetings` | A + meeting read | Generated query/response | 400/403 Problem, 200 | Scoped monthly read | reliability + overview |
| POST `/meetings` | A + meeting create/house scope | Generated body/response | 400/403/404 Problem, 201 | Insert; no idempotency key | reliability + critical workflows |
| GET `/houses` | A + mounted sensitive prefix | Ad hoc safe projection | 401 Problem, 200 | Scoped read | reliability + authorization |
| GET `/applications` | A; staff only; house scoped | Ad hoc DB projection | 403 Problem, 200 | Scoped read + audit | reliability + authorization |
| POST `/applications` | A; staff only; house scoped | Allowlisted body | 400/403 Problem, 201 | Insert + audit; no idempotency key | reliability + authorization |
| PATCH `/applications/:id` | A; staff only; house scoped | Allowlisted body + strict positive ID | 400/403/404 Problem, 200 | Update + audit; last-write-wins | reliability + authorization |
| GET `/documents` | A; resident/house scope | Ad hoc safe projection | 403 Problem, 200 | Scoped read + audit | reliability + documents |
| POST `/documents` | A; staff with resident scope | Allowlisted server-controlled metadata | 400/403/404 Problem, 201 | Transactional metadata/history/audit; no idempotency key | reliability + documents |
| GET `/documents/:id/history` | A; staff + concealed scope | Strict positive ID; ad hoc history | 400/404 Problem, 200 | Read + audit | reliability + documents |
| PATCH `/documents/:id` | A; staff + concealed scope | Allowlisted body + strict positive IDs | 400/404 Problem, 200 | Transactional update/history/audit; last-write-wins | reliability + documents |
| GET `/operations` | A; resident/house scope | Ad hoc operation rows | 200 | Scoped read + audit | reliability + authorization |
| POST `/operations` | A + resident write scope | Allowlisted body | 400/404 Problem, 201 | Insert + audit; no idempotency key | reliability + authorization |
| GET `/reports/summary` | A + report read | Ad hoc bounded summary | 403 Problem, 200 | Multi-query read + audit | reliability + reports |
| GET `/reports/:reportType` | A + report read/house scope | Enum/date validation; ad hoc report | 400/403/404 Problem, 200 | Multi-query read + audit | reliability + reports |
| GET `/reports/:reportType/export` | A + report export (Admin) | Enum/date validation; CSV/PDF | 400/403/404 Problem, 200 file | Multi-query read + audit; stream/file content type | reliability + reports |
| GET `/assessment-templates` | A | Generated response | 200 | Scoped read + audit | reliability + assessments |
| GET `/assessment-templates/:id` | A + concealed visibility | Generated params/response | 400/404 Problem, 200 | Read + audit | reliability + assessments |
| POST `/assessment-templates/:id/revisions` | A + assessment manage | Strict generated params/body/response | 400/403/404 Problem, 201 | Insert + audit; version conflict remains DB-integrity concern | reliability + assessments |
| POST `/assessment-templates/:id/publish` | A + assessment manage | Generated params/response | 400/403/404/409 Problem, 200 | Conditional transaction; concurrent change 409 | reliability + assessments |
| POST `/assessment-templates/:id/retire` | A + assessment manage | Generated params/response | 400/403/404/409 Problem, 200 | Conditional update; concurrent change 409 | reliability + assessments |
| GET `/residents/:id/assessments` | A + resident scope | Generated params/response | 400/403/404 Problem, 200 | Read + audit | reliability + assessments |
| POST `/residents/:id/assessments` | A + resident/template scope | Strict generated params/body/response | 400/403/404 Problem, 201 | Insert + audit; duplicate drafts allowed by current contract | reliability + assessments |
| GET `/assessments/:id` | A + concealed resident/template scope | Generated params/response | 400/403/404 Problem, 200 | Read + audit | reliability + assessments |
| PATCH `/assessments/:id` | A + resident/template write scope | Strict generated params/body/response | 400/403/404 Problem, 200 | Draft update + audit; submitted record immutable | reliability + assessments |
| POST `/assessments/:id/submit` | A + resident/template write scope | Strict generated params/body/response | 400/403/404 Problem, 200 | Conditional draft-only transition; duplicate submit rejected | reliability + assessments |
| GET `/residents/import/template` | A + resident import | Query enum; CSV/XLSX file | 400/403 Problem, 200 file | No write | reliability + import integrity |
| POST `/residents/import/preview` | A + resident import | File/type/size/row validation | 400/403 Problem, 201 | Transactional batch/rows/audit; repeated preview creates batches | reliability + import integrity |
| POST `/residents/import/:batchId/confirm` | A + resident import/actor scope | Strict positive batch ID and distinct rows | 400/403/404/409 Problem, 200 | Locked transaction; repeated/concurrent confirm rejected | reliability + import integrity |
| POST `/storage/uploads/request-url` | A; staff roles | Hand metadata validation; provider response | 400/403/503 Problem, 200 | Signed URL dependency; no application write | reliability + resilience |
| GET `/storage/objects/*path` | A + approved document/resident scope | Document metadata gates binary stream | 404/503 Problem before headers; partial stream is terminated | Object storage timeout/error destroys partial response | reliability + documents/resilience |

## Mounted versus supported contract surface

The baseline found 58 effective route declarations and no shadowed duplicate declaration. `/auth/session` exists once and is self-authenticated before the protected-prefix mount.

OpenAPI currently describes the supported generated-client surface: health/readiness/session, dashboard, residents, assessments, resident import, payments, activity, houses, expenses, income, meetings, and reports. The following mounted operational/admin routes are intentionally not generated-client operations and must not be mistaken for anonymous or unsupported routes: account bootstrap/register/login/recovery/admin management, applications, document metadata/history, generic operations, report summary, and object-storage URL/stream endpoints. The reliability harness inventories both sets and fails when the expected distinction changes without this report and its allowlist changing together.

## Missing product domains

- **Medications:** not implemented; no mounted endpoint, OpenAPI operation, persistence service, or reliability contract.
- **Case notes / recovery notes:** not implemented as a dedicated endpoint or module.
- **Dedicated UA results:** not implemented. Current generic `POST /operations` records a typed, titled, dated resident operation and can represent UA activity, but it does not provide a dedicated UA schema or workflow.
- **Individual resident check-in:** not implemented. Aggregate meeting attendance is available through `/meetings`; generic operations can represent scheduled/completed resident check-in activity, but neither is a dedicated resident check-in product contract.

No new endpoints are added for these domains by this audit.

## Pre-declared compatibility changes

| Affected callers | Old behavior | New behavior | Compatibility |
| --- | --- | --- | --- |
| Any caller receiving a deliberate 4xx/5xx route error | Some routes returned `application/json` with only `{error}` | Every API error response is no-store problem JSON and includes `correlationId`; existing safe `error` text remains when intentional | Additive payload field and more specific content type |
| Admin/application/document/import path-ID callers | JavaScript `Number()` accepted non-canonical forms such as `1e2`, `+1`, or whitespace-padded IDs | Only canonical decimal positive 32-bit integer path segments are accepted; malformed values return 400 Problem | Intentional rejection of ambiguous unsafe input |
| Timed-out mutation callers | Middleware could answer while downstream work continued without a request-expired signal | Timeout marks and aborts the request context; guarded mutations refuse to begin/continue after expiration and late response attempts are suppressed | Safer failure; callers must still reconcile indeterminate external-provider/DB commits |
| Release verification | Reliability behavior was spread across optional/skipping suites | One non-skipping API reliability command validates route inventory, failure shape, malformed JSON, authorization boundary, timeout signaling, and controlled dependency failures | New required gate; no success contract change |

## Repeatable command and evidence

Run:

```sh
pnpm --filter @workspace/api-server run test:reliability
```

The command is API-only, creates an ephemeral localhost listener, does not touch production data, and treats source-route, report, OpenAPI, or generated-client drift as a failure rather than a skip. It deterministically exercises the shared failure boundary with controlled dependency and delay failures. Database-backed success and concurrency remain in the existing non-skipping API suites and disposable-database critical workflow layer; this command does not claim to replace or conditionally compose those suites.

Final command results and residual risks are recorded after implementation in the final evidence section.

## Final evidence

Completed on 2026-09-02:

- `pnpm --filter @workspace/api-server run test:reliability`: 6/6 passing; no skips, including expiration between transaction steps.
- Existing mounted-API suites: resilience 4/4, security controls 4/4, authorization 4/4, report exports 17/17, document sharing 4/4, import integrity 3/3, overview 2/2, assessments 4/4, and rate-limit/readiness 5/5 passing; no skips.
- `pnpm run security:release-gate`: 24/24 passing.
- `pnpm run typecheck`: passing across libraries, API, web, design preview, and scripts.
- `pnpm run build`: production web and API builds passing.
- OpenAPI generation completed and a second generation produced byte-identical generated client/validator trees. The normal clean-tree `codegen:check` reports the intentional generated diff until these contract changes are committed.
- API workflow restart completed cleanly; development `/api/healthz` returned 200 JSON with `Cache-Control: no-store` and an `X-Correlation-ID`.

### Applied endpoint-layer fixes

- Normalized all deliberate and unexpected API failures to safe correlated problem JSON without replacing intentional safe error text.
- Enforced canonical positive 32-bit path IDs on generated and handwritten ID routes.
- Removed duplicate-session-route ambiguity from the effective inventory and made route drift fail the reliability command.
- Added request-expiration and abort state, guarded every mounted mutation before side effects, and added checks between multi-step transaction writes.
- Declared the additive readiness-failure correlation ID in OpenAPI and regenerated clients/validators.

### Residual risks and scope boundaries

- A database statement or object-storage request already in flight when the deadline expires cannot be forcibly cancelled by the current adapters. Transactions check request state between statements and roll back when a later check fails, but callers must still reconcile an indeterminate single statement or external-provider operation after a timeout.
- Payment, expense, income, meeting, application, document, and generic-operation creates do not expose idempotency keys. Their database constraints and concurrency behavior remain database-integrity/payment workflow scope rather than an endpoint contract invented by this audit.
- OpenAPI intentionally describes the supported generated-client product surface, not every internal authentication, administration, application, document, operation, report, or storage route. The reliability inventory separately fails if the mounted source declarations or report drift.
- Medications, case notes, dedicated UA results, and individual check-in modules remain explicitly unimplemented. Generic operations remain the current UA/check-in representation.