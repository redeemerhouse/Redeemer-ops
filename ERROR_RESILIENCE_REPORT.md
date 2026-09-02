# Error Resilience Report

**System:** Redeemer House ONEsource web and API runtime  
**Audit date:** 2026-09-01  
**Scope:** Runtime request, dependency, startup, database-write, file/stream, browser-network, query/mutation, and render failure paths.

## Dependency classification

| Dependency | Class | Required behavior | Implemented behavior |
|---|---|---|---|
| PostgreSQL business data | **CRITICAL** | Fail readiness and affected requests closed; never substitute stale or fabricated records | `/api/readyz` returns a non-sensitive `503`; rejected route work reaches the API exception boundary; bounded pool connection, statement, and query timeouts remain enabled |
| PostgreSQL-backed sessions and production rate limits | **CRITICAL** | Deny access when state cannot be verified | Session lookup outages now return a generic correlated `503`, not a misleading `401`; the production rate-limit store continues to fail closed |
| Production configuration and session secret | **CRITICAL** | Refuse unsafe startup | Configuration validation throws before listening; startup logs only error type and exits deliberately after cleanup |
| Transactional email (Resend connector) | **OPTIONAL** | Commit valid core account/token state independently; fail only delivery | Delivery is bounded to 10 seconds, provider status/body is not exposed, failures are logged and audited best-effort, and verification/reset can be requested again |
| Replit App Storage sidecar/provider | **DEGRADED-OPERATION ALLOWED** | Fail document upload/download only | Sidecar and metadata operations are bounded, malformed provider responses become typed failures, and stream errors terminate the response without stopping unrelated traffic |
| Browser/API network | **DEGRADED-OPERATION ALLOWED** | Leave loading state, show safe recovery, preserve navigation | Shared fetch has a 30-second default timeout, safe network/parse error types, bounded query retries, page query recovery actions, and route/root render boundaries |
| Report/import parsing in process memory | **DEGRADED-OPERATION ALLOWED** | Reject malformed input without process failure or raw parser details | Import parsing returns allowlisted validation messages; report/download failures stay in their workflow and leave controls usable |

## Search inventory

The audit searched `throw`, `catch`, `process.on/once/exit`, Express error middleware, `fetch`/connector calls, PostgreSQL pool/database operations, transactions, file parsing, metadata calls, streams, React queries/mutations, loading branches, and render boundaries across:

- `artifacts/api-server/src`
- `artifacts/api-server/test`
- `artifacts/recovery-housing-operations/src`
- `lib/api-client-react/src`
- `lib/db/src`
- `SECURITY_OPERATING_MODEL.md`
- `threat_model.md`

## Findings and disposition

| Severity | Evidence | Dependency class | Confirmed failure behavior | Remediation | Verification | Residual risk |
|---|---|---|---|---|---|---|
| Critical | `artifacts/api-server/src/middlewares/auth.ts` session database lookups | CRITICAL | Database exceptions were converted to unauthenticated state, obscuring an outage | Session lookup failures now emit privacy-safe diagnostics and enter the shared exception boundary as correlated `503` responses | Resilience test covers typed dependency response; authorization/security suites cover normal denial | A database outage still blocks all protected work by design |
| Critical | `artifacts/api-server/src/index.ts` listener and signal handling | CRITICAL | Listener failure had cleanup, but uncaught exceptions and unhandled rejections had no explicit policy | Added one fatal path for startup, listener, uncaught exception, and unhandled rejection; it logs error type only, closes HTTP and pool resources, and force-exits after 10 seconds | Typecheck/build plus source review | In-flight requests may be terminated during the 10-second shutdown ceiling |
| High | `artifacts/api-server/src/middlewares/errors.ts` | CRITICAL / DEGRADED | Known `503` errors could be normalized to `500`; writing after headers could trap a streaming client | Known safe 4xx/5xx statuses are preserved, all responses carry correlation IDs, and committed responses are destroyed instead of double-written | Fault-injection test asserts generic `500` and `503` bodies contain no injected SQL, credentials, resident email, or stack text | Transport-level disconnects cannot carry a final JSON problem after headers are sent |
| High | `artifacts/api-server/src/routes/auth.ts` registration/token/email sequence | OPTIONAL email over CRITICAL database | Account creation, action-token creation, and audit were not one atomic core write; email errors shared the same broad catch | Core account, verification token, and registration audit now commit in one transaction; delivery occurs afterward with observable retry guidance | Typecheck and auth lifecycle/security suites | Notification delivery has no automated queue; users or staff must request another code |
| High | `artifacts/api-server/src/lib/auth-email.ts` | OPTIONAL | Connector calls had no deadline and surfaced provider status in thrown text | Added a 10-second deadline and typed generic failure with no provider body/status | Source-level fault contract plus existing auth request behavior | Connector cancellation is unavailable in the installed SDK; timeout stops waiting but cannot cancel provider work |
| High | `artifacts/api-server/src/lib/objectStorage.ts`, `routes/storage.ts` | DEGRADED-OPERATION ALLOWED | Sidecar/provider calls had no deadline; malformed JSON and stream errors could become ambiguous 404s or leave a partial response | Added deadlines, response-shape checks, typed 400/404/502/503 failures, privacy-safe logs, and post-header response destruction on stream error | Resilience tests inject malformed and unavailable provider responses | Google client metadata/stream cancellation is limited to destroying the response; provider work may continue briefly |
| High | `lib/api-client-react/src/custom-fetch.ts` | DEGRADED-OPERATION ALLOWED | Hung fetches could leave views loading; response stream/parser/network errors could expose runtime text if rendered directly | Added a 30-second default deadline, caller cancellation composition, safe `NetworkError`/`ResponseParseError`, and allowlisted API errors | Fault tests inject malformed JSON, rejected fetches, sensitive error bodies, and a hung request | A large successful body is still bounded primarily by the server response limit and browser memory |
| Medium | `artifacts/recovery-housing-operations/src/App.tsx`, `components/error-boundary.tsx` | DEGRADED-OPERATION ALLOWED | Query retry behavior was unbounded by local policy and development render fallback displayed raw error messages | Queries retry at most twice only for retryable classes; mutations do not auto-repeat; render fallback never displays the captured error and resets on route change | Web typecheck/build and browser pass | User-entered unsaved form state is lost if the render subtree itself crashes |
| Medium | Page query and operation flows under `artifacts/recovery-housing-operations/src/pages` | DEGRADED-OPERATION ALLOWED | Existing query recovery was broad, but direct document upload lacked a visible failure state and upload timeout | Shared `QueryState` keeps bounded loading/error/retry behavior; document upload now times out and renders a safe retryable message while preserving the modal | Web typecheck/build and browser pass | Some mutations use page-specific generic wording rather than one visual component |
| Low | `artifacts/api-server/src/routes/resident-import.ts`, transaction-backed assessment, auth, retention, and operations writes | CRITICAL | Required multi-record writes could be vulnerable if executed outside transactions | Audit confirmed resident import batches/rows/confirmations, action tokens, password reset, assessment publication, retention changes, and registration core state use transactions; no destructive schema work was performed | Existing resident-import, assessment, auth, retention, and critical-workflow suites | The separate audit-trail task remains responsible for proving every sensitive route has complete audit semantics |

## Stable failure contract

API clients receive only an allowlisted message and `correlationId` in `application/problem+json`. Logs include correlation ID, error type, dependency, failure category, retryability, and status where available. They intentionally exclude raw request bodies, query values, route parameters, resident contact data, credentials, SQL, provider response bodies, and stack traces.

Typed service failures distinguish `unavailable`, `invalid`, `not_found`, and `unexpected` outcomes. Critical session/database failures return `503`; invalid/not-found object requests return `400`/`404`; malformed provider responses return `502`; unknown failures return generic `500`.

## Atomicity and post-commit effects

- Resident import preview and confirmation keep batch, row, resident, and audit updates in database transactions.
- Password reset completion keeps token claim, password update, and session revocation in one transaction.
- Account registration keeps account, one-time verification token, and registration audit creation in one transaction.
- Assessment publication and retention workflows retain their existing transactional boundaries.
- Email delivery is post-commit and optional. Failure does not roll back valid core state; structured diagnostics and a failed-delivery audit attempt identify the outcome, while the verification/password-reset request endpoints provide manual recovery.

## Verification record

The final validation run must include:

- `pnpm --filter @workspace/api-server run test:resilience`
- API authorization, security controls, resident import, assessments, and critical workflow suites
- `pnpm run codegen:check`
- `pnpm run typecheck`
- `pnpm run build:production`
- One browser pass over sign-in failure recovery, page query recovery, and navigation after a render/query failure

Final results:

| Check | Result |
|---|---|
| Focused error resilience fault injection | **PASS** — 4 tests: correlated API redaction, dependency classification, malformed/network/hung client requests, malformed/unavailable storage |
| Workspace typecheck | **PASS** — libraries, API, web, mockup sandbox, and scripts |
| Production web and API builds | **PASS** |
| OpenAPI/Orval generation drift | **PASS** |
| Security controls and shared rate-limit recovery | **PASS** — 9 tests |
| Authorization | **PASS** — 4 tests, including context-free house-manager mutation denial |
| Resident import integrity and assessments | **PASS** — 7 tests |
| Reports, documents, and overview | **PASS** — 23 tests |
| Architecture, policy, and retention | **PASS** — 15 tests |
| Managed API/web workflow restart and startup logs | **PASS** — both services running with clean current startup logs |
| Browser recovery pass | **PASS** — sign-in rendered, invalid credentials exited pending state with safe text, no page exception occurred, and navigation remained responsive |
| Critical-workflow isolated harness | **NOT RUN** — safely refused because `TEST_DATABASE_ADMIN_URL` is not configured; the harness requires a dedicated disposable database and explicitly forbids production |

The isolated harness limitation is accepted for this development environment. Its constituent live API security, authorization, import, assessment, report, document, and browser flows were run separately above. No production or shared database was substituted.