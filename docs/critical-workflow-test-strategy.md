# Critical Workflow Test Strategy

This suite is risk-based: confidentiality and authorization failures come first, followed by financial integrity, auditability, and database relationship integrity. All integration and browser fixtures are synthetic. The harness creates a new database, applies the real migration chain, and drops that database on exit.

## Safety and prerequisites

- Never set `TEST_DATABASE_ADMIN_URL` to a production database or production cluster.
- The harness refuses `NODE_ENV=production` and Replit deployment runtimes, rejects production- and
  shared-development-like URL names, creates a database named `critical_workflow_test_*`, and
  only runs after the exact confirmation
  `CRITICAL_TEST_DB_CONFIRM=create-and-drop-disposable-database`. It launches the API with
  `APP_ENVIRONMENT=test`, `DATABASE_TARGET=disposable-test`, and
  `PAYMENT_PROVIDER_MODE=disabled`; those declarations are required by the API itself.
- Required local/CI tools: Node, pnpm, PostgreSQL client tools (`createdb`, `dropdb`, `psql`), and a Playwright Chromium installation.
- Run the full gate:

  ```sh
  TEST_DATABASE_ADMIN_URL="$NON_PRODUCTION_DATABASE_URL" \
  CRITICAL_TEST_DB_CONFIRM=create-and-drop-disposable-database \
  pnpm run test:deployment
  ```

- Missing prerequisites are failures, not skipped green tests. The command prints per-layer results and ends with exactly `DEPLOYMENT CHECK PASS` or `DEPLOYMENT CHECK FAIL`.
- Recovery evidence is enforced separately by `.github/workflows/recovery-drill-evidence.yml`. The
  job provisions a dedicated PostgreSQL service, masks its assembled URL, and runs
  `pnpm run test:db-release-evidence` with `RECOVERY_DRILL_REQUIRED=true`. Missing configuration
  therefore fails before the recovery test can be registered as skipped. Its evidence lines are
  limited to statuses and counts.

## API reliability and contract layer

`pnpm --filter @workspace/api-server run test:reliability` is the fast, non-skipping API-only gate. It starts only ephemeral localhost listeners and does not require or modify database data. It verifies the complete mounted route inventory against the API reliability report, verifies the generated-client subset against OpenAPI, and exercises malformed JSON, authentication, deliberate errors, missing routes, dependency failures, response-schema failures, strict identifiers, and timeout cancellation. Any inventory or expected-contract drift fails until the report and explicit allowlist are reviewed together.

The disposable-PostgreSQL integration layer remains authoritative for successful persistence, transaction, duplicate/concurrent submission, and row-scope behavior. The browser layer remains authoritative for client journeys. The API-only gate complements those layers; it does not silently substitute mocks for persistence evidence.

## Risk inventory

| Priority / risk | Implemented workflow | Layer | Status |
| --- | --- | --- | --- |
| Authentication confidentiality | Sign-in; expired credentials; sensitive UI hidden after session loss | Integration, browser | Covered at critical-flow depth; deeper revocation lifecycle remains separately tracked |
| Resident confidentiality and integrity | Create, search/load, edit, house scoping, malformed input | Unit, integration, browser | Covered |
| Document confidentiality and auditability | Metadata creation, history, replacement/access visibility, resident/cross-house visibility | Unit, integration, browser API within authenticated context | Covered; binary storage bytes are deliberately substituted with controlled object paths |
| Payment integrity | Validation, role/house scope, paid ledger entry, resident balance effect | Unit, integration, browser | Covered at workflow depth; tampering/corrections/reversals remain separately tracked |
| Assessment integrity | Active template, draft, required fields, submit, duplicate submit, immutable version snapshot, template-management permission | Unit, integration, browser | Covered |
| Staff permissions | Owner, house manager, resident, organization, and cross-house policy decisions | Unit, integration | Covered |
| Auditability | Resident activity and document history records | Integration | Covered through workflow assertions and real database persistence; broader per-workflow audit assertions are recommended |
| Relationship integrity | Payment-to-resident foreign key and meeting attendance checks | PostgreSQL integration | Covered for directly asserted constraints; migrations apply the remaining schema relationships |
| Current check-in / meeting records | Existing meeting attendance workflow and constraints | Integration | Covered for meetings; there is no dedicated mobile resident check-in workflow |
| API outage / network failure | Unavailable endpoint fails closed; browser session-network failure hides records | Integration, browser | Covered at current supported boundary; broader timeout and sanitized browser error handling remain separately tracked |
| Duplicate submission | Submitted assessment cannot be submitted again | Integration | Covered where the product enforces it; payment/resident idempotency is not implemented |
| Database unavailable | Startup/request dependency failure is non-success | Integration | Covered by explicit unavailable-network failure; deeper resilience behavior remains separately tracked |
| Mobile resident check-ins | No dedicated product workflow | None | **Untested high-risk gap** |
| UA result logging | No dedicated product workflow | None | **Untested high-risk gap** |
| Medication administration records | No dedicated product workflow | None | **Untested high-risk gap** |
| Recovery notes | No dedicated product workflow | None | **Untested high-risk gap** |
| Case notes | No dedicated product workflow | None | **Untested high-risk gap** |

## TEST COVERAGE CREATED

- Pure unit coverage for authorization decisions, required and nested assessment answers, calendar dates, money boundaries, document metadata, and document visibility.
- A reusable disposable-PostgreSQL harness that runs the real migration chain, deterministic synthetic fixtures, the built API, authentication middleware, API workflow tests, database constraints, and teardown.
- API integration coverage for resident create/load/edit, house scope, documents/history/visibility, meetings, payments and balance effects, assessments, permissions, resident/document audit evidence, malformed data, duplicate assessment submission, expired credentials, and unavailable endpoints.
- Playwright journeys at desktop Chrome and Pixel 7 viewports for sign-in, resident create/load/edit, authenticated document metadata/history, payment recording, recovery-capital assessment validation/submission, and session-network-failure privacy.
- A root `pnpm run test:deployment` gate with nonzero failure and unmistakable final summary, composed into the established `pnpm run release:verify` command.

## CRITICAL FLOWS TESTED

1. A permitted staff member creates and edits a resident in scope; cross-house access fails without revealing the resident.
2. Staff create controlled document metadata, inspect history, change visibility, and verify an unapproved record remains hidden from residents and cross-house staff.
3. Staff record meeting attendance while malformed dates, impossible attendance counts, and cross-house writes fail.
4. Staff record a paid payment and the resident balance changes in the same database transaction.
5. Staff start, save, validate, and submit a recovery-capital assessment; repeat submission and unauthorized template management fail.
6. Browser sessions sign in through the real UI, complete resident/payment/assessment journeys, and hide records when authentication expires.

## UNTESTED HIGH-RISK AREAS

- Mobile resident check-ins, UA result logging, medication administration records, recovery notes, and case notes have no dedicated product workflows and therefore no honest end-to-end tests.
- Binary document upload/download is not exercised because approved object-storage upload is outside this task; tests use controlled metadata and object paths.
- Payment corrections, bank-return reversals, QuickBooks reconciliation, advanced payment tampering, deep authentication revocation, and broad browser error sanitization remain outside this task and are tracked separately.
- Resident and payment creation do not currently expose idempotency keys, so duplicate-write prevention cannot be asserted without changing application behavior.
- Resident self-profile reads currently fail closed when the route supplies house context. Correcting that permission behavior is outside this test-only task; the staff-scoped create/load/edit workflow remains covered.

## RECOMMENDED NEXT TESTS

1. Add focused tests alongside each missing dedicated clinical or resident workflow when that workflow is implemented, beginning with mobile check-ins and medication/UA records.
2. Add real object-storage upload/download browser coverage after approved resident document upload exists.
3. Extend the same deployment gate by composing the separately tracked authentication lifecycle, payment tampering/correction, access-rule, and browser error-sanitization suites when those tasks land.