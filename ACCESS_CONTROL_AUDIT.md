# Redeemer House Authentication and Authorization Audit

**Audit date:** 2026-09-01  
**Policy baseline:** `SECURITY_OPERATING_MODEL.md`  
**Enforcement boundary:** Express authentication middleware, centralized permission checks, resource-scoped database queries, role-shaped responses, and revocable PostgreSQL sessions.

This report records the effective behavior of the mounted application. Browser navigation, hidden buttons, generated clients, and OpenAPI descriptions were inspected for drift but were not treated as security controls.

## ROLE MATRIX

Legend: **All** = organization-wide; **Assigned** = residents or houses in the server-derived house assignment; **Own** = authenticated resident record only; **No** = denied at the server; **Absent** = no mounted operation.

| Mounted surface / record | Action | Owner administrator | Program director | House manager | Resident | Effective server rule |
|---|---|---:|---:|---:|---:|---|
| Health | VIEW | Public | Public | Public | Public | `GET /api/healthz` is the only public operational endpoint. |
| Browser session | VIEW | Own | Own | Own | Own | `GET /api/auth/session` requires a valid signed credential; production credentials must map to an active, unexpired, unrevoked database session. |
| Authentication | CREATE | Own | Own | Own | Own | Register, verification, login, recovery, and logout are public lifecycle operations with uniform recovery/login responses; registration creates an unapproved account only. |
| Account access | VIEW | All | All except ownership controls | No | No | Account administration is authenticated inside the auth router. |
| Account access | ADMINISTER | All | Non-owner accounts; cannot grant/manage `owner_admin` | No | No | Self-management is denied; role/house/status changes revoke target sessions. |
| Dashboard | VIEW | All | All | Assigned aggregates | No | Manager rows, payments, houses, expenses, income, meetings, and operations are house-scoped. |
| Activity / audit feed | VIEW | All | All | Assigned resident/payment events, minimized | No | Manager events are filtered to visible resident and payment IDs. |
| Residents / PII | VIEW | All | All | Assigned | Own | Detail and predictable-ID requests combine ID with role/house/resident scope; residents do not receive staff notes. |
| Residents / PII | CREATE | All | All | Assigned target house | No | Target house is authorized from the parsed body. |
| Residents / PII | EDIT | All | All | Assigned source and target house | No | Existing record and requested target house are independently checked. |
| Residents / PII | DELETE | Absent | Absent | Absent | Absent | No mounted resident deletion route. Quarantine is not exposed through the application router. |
| Resident import | VIEW/CREATE | All | All | Assigned houses | No | Template and preview require import permission; manager confirmation is limited to the manager’s own batch and assigned target houses. |
| Payments | VIEW | All | All | Assigned residents | Own | List filters are joined to residents and scoped server-side. |
| Payments | CREATE | All | All | Assigned residents | No | Resident ownership and payment status are derived server-side; resident ID substitution returns not-found. |
| Payments | EDIT/DELETE | Absent | Absent | Absent | Absent | Corrections and reversals are separate deferred product work. |
| Expenses | VIEW/CREATE | All | All | No | No | Organization financial ledger is administrator-only. |
| Income | VIEW/CREATE | All | All | No | No | Organization income ledger is administrator-only. |
| Houses | VIEW | All | All | Assigned houses | Own current house | Returned house list is scoped from the principal; no house mutation route is mounted. |
| Meeting attendance | VIEW | All | All | Assigned houses | No | Manager lists are restricted by assigned house IDs. |
| Meeting attendance | CREATE | All | All | Assigned explicit house | No | A manager mutation without a house context is denied. |
| Applications / intake PII | VIEW | All | All | Assigned preferred houses | No | Manager list is restricted to assigned house IDs. |
| Applications / intake PII | CREATE | All | All | Assigned target house | No | Manager target house must exist and be assigned. |
| Applications / intake PII | EDIT | All | All | Assigned source and target house | No | Source authorization no longer permits retargeting to another house. |
| Applications / intake PII | DELETE | Absent | Absent | Absent | Absent | No mounted application deletion route. |
| Document metadata | VIEW | All | All | Assigned residents | Own approved and explicitly shared records | Resident lists require `visibility=resident` and `status=approved`; direct history is staff-only and resource-scoped. |
| Document metadata | CREATE | All | All | Assigned residents | No | Current upload flow is staff-only. Status is forced to `uploaded`. |
| Document metadata | EDIT | All | All | Assigned source and target residents | No | Title/category/sharing/subject may change in scope; object bytes, file metadata, uploader, application link, and approval state are immutable client-side. |
| Document bytes | VIEW | All | All | Assigned residents | Own approved and explicitly shared records | Direct object paths require a matching document, `status=approved`, resident scope, and sharing state. Responses are `no-store`. |
| Document DELETE | DELETE | Absent | Absent | Absent | Absent | Uploaded files have no mounted delete route. |
| Daily operations / notes | VIEW | All | All | Assigned residents | Own non-private records | Resident response excludes `private=true` records. |
| Daily operations / notes | CREATE | All | All | Assigned residents | No | A real resident is required; context-free and cross-house writes return not-found. |
| Assessment templates | VIEW | All versions | All versions | Active only | Active resident-audience only | Non-administrators cannot discover drafts/retired templates. |
| Assessment templates | ADMINISTER | All | All | No | No | Revision, publish, and retire use centralized `assessment:manage`. |
| Assessment submissions | VIEW | All | All | Assigned residents | Own resident-audience assessments | Submission ID is resolved to its resident before access is decided. |
| Assessment submissions | CREATE/EDIT | All | All | Assigned residents | Own resident-audience assessments | Draft-only edits; resident ID and template audience are checked server-side. |
| Reports | VIEW | All | All | Assigned rows for permitted operational reports | No | Manager report rows are derived from assigned residents/houses. |
| Reports | EXPORT | All | All | No | No | `report:export` uses the authenticated principal, never `X-User-Role`. |
| Storage upload URL | CREATE | All | All | Yes, followed by scoped document creation | No | A signed upload URL alone does not create an accessible document. |
| Organization policy, permanent deletion, restore | ADMINISTER | Absent | Absent | Absent | Absent | No mounted application surface; these operations must not be inferred from role names or retention helpers. |

No role has a generic DELETE permission on a mounted business-record endpoint. No separate “regular administrator” role exists: the database and middleware accept exactly `owner_admin`, `program_director`, `house_manager`, and `resident`. Unknown or forged role claims fail authentication.

## Sensitive-data mapping

| Requested category | Actual current storage / route | Visibility and record scope |
|---|---|---|
| Resident PII | `residents` fields `name`, `email`, `phone`, `home`, dates, status, balance, and notes; `/residents`, dashboard, reports | Administrators all; managers assigned houses; residents own row with staff notes omitted. Exports are administrators only. |
| Payment information | `payments` amount, due/paid dates, status, method, resident relation; `/payments`, dashboard, reports | Administrators all; managers assigned residents; residents own records read-only. No card data or payment processor route exists. |
| Documents | `documents` metadata/object path/visibility/status plus immutable `document_history`; `/documents`, `/storage/objects/*path` | Administrators all; managers assigned residents; residents own approved and explicitly shared records. Metadata and bytes fail closed unless status is `approved`. Resident uploads are not implemented. |
| Assessments | `assessment_templates` and `assessment_submissions.answers`; assessment routes | Administrators all; managers assigned residents; residents own submissions only when the template audience is `resident`. |
| Recovery notes / plans | `residents.notes`, `operations.notes`, and potentially assessment answers | Resident profile notes are staff-only; resident operation access excludes private records; assessment audience and resident scope apply. There is no separately typed recovery-plan record. |
| Case notes | No dedicated case-note table. Case-management meeting labels and free-text operational notes exist. | Governed as meeting/operation data; residents cannot access aggregate meetings and cannot see private operation records. |
| Medication | Absent. No medication table, field, route, generated client, or mounted UI operation was found. | No access is granted. A future feature requires an approved category policy and new server checks. |
| UA / drug-screening data | Absent. No dedicated UA/result table, field, route, generated client, or mounted UI operation was found. | No access is granted. A future feature requires explicit own/assigned/admin response shaping. |
| Resident household / child data | `applications.familyInformation` JSON intake field; no separate child account or household route | Administrators all; managers only applications for assigned preferred houses; residents have no mounted intake read route. |
| Referral / treatment / spiritual intake | `applications.referralHistory`, `treatmentHistory`, `spiritualReflection` | Administrators all; managers assigned preferred houses; residents denied. Referral export is administrator-only. |
| Audit data | `audit_events`; activity, summary, and audit report routes | Administrators organization-wide; managers receive only minimized assigned resident/payment activity; residents denied. |

## SECURITY FINDINGS

| ID | Severity | Finding / exploit path | Affected roles and data | Remediation status and evidence |
|---|---|---|---|---|
| AC-01 | Critical | Sensitive route prefixes could be called directly without relying on the browser. | Anonymous callers; all sensitive data | **Previously remediated, verified.** Route-mount authentication returns `401`; forged `X-User-Role` is ignored. `authorization.test.mjs`. |
| AC-02 | High | Manager mutations authorized without a resource context could create an unscoped meeting record. | House managers; attendance records | **Fixed.** `meeting:create` now requires an explicit assigned house for managers; administrators retain organization-wide creation. |
| AC-03 | High | A manager authorized against an application’s current house could change `preferredHouseId` to another house. | House managers; intake PII | **Fixed.** Source and target houses are independently loaded and authorized. |
| AC-04 | High | Predictable import batch IDs allowed one manager to attempt confirmation of another actor’s preview batch. | House managers; resident PII creation | **Fixed.** Manager confirmation requires `batch.actor === principal.sub`, then rechecks every row’s target house. Administrators retain organization-wide workflow authority. |
| AC-05 | High | Resident operation listing included staff-private records associated with the resident. | Residents; recovery/case/operational notes | **Fixed.** Resident queries add `private=false`; managers and administrators retain their legitimate scoped access. |
| AC-06 | High | A client could forge upload provenance/application association, patch document `status`, or replace object/file metadata, bypassing scan authority and upload immutability. | Staff accounts; document contents | **Fixed fail-closed.** Creation derives uploader and rejects client status/application linkage; approval state and file metadata are immutable through patch. Resident metadata and all downloads require `status=approved`; protected bytes are `no-store`. |
| AC-07 | Medium | Malformed percent encoding in the session cookie could throw before normal authentication failure handling. | Anonymous callers; auth availability/error behavior | **Fixed.** Cookie decoding catches malformed encoding and returns the uniform `401`, clearing no unrelated state. |
| AC-08 | Medium | Two `/auth/session` handlers returned drifting response shapes. | All authenticated users; browser bootstrap | **Fixed.** The generated-contract-backed session router is the sole mounted implementation. |
| AC-09 | Medium | Resident search interpolation built an object string rather than the intended wildcard pattern. | Staff and residents; record discovery behavior | **Fixed.** The parsed bounded search string is now used as `%search%` while existing principal scope remains in the same SQL predicate. |
| AC-10 | High | Direct numeric IDs and client-provided resident filters are predictable. | Residents and managers; resident/payment/document/assessment data | **Mitigated and verified.** Detail/mutation handlers resolve the resource and combine it with principal scope; inaccessible and missing records use not-found behavior. Regression tests cover cross-house, cross-resident, and large predictable IDs. |
| AC-11 | High | Browser-cached sensitive data could remain visible after expiry/logout. | All browser users | **Previously remediated, verified by inspection/build.** Unauthorized responses and expiry clear the entire query cache; logout clears local state in `finally`; protected routing remains closed during bootstrap and error states. |
| AC-12 | Medium | Session claims could remain usable after logout/password/role/status changes. | All authenticated users | **Previously remediated, integration-tested.** Production credentials require a live DB session; logout, reset, assignment, deactivation, and explicit revocation set `revokedAt`. Idle and absolute expiry are checked on every request. |

## CRITICAL ACCESS RISKS

1. **No malware scanning/approval service is mounted.** Resident metadata and downloads fail closed unless a document is already server-marked `approved`, but there is no reviewed scanner callback or administrator approval endpoint in the current application. Do not manually update status in production to simulate scanning.
2. **Medication and UA data are absent, not implicitly protected features.** Adding either to generic notes or assessment answers without explicit category/audience shaping would create a new sensitive-data boundary.
3. **Deletion administration is not mounted.** The retention service must not be exposed until owner-only restore/permanent-delete approval and program-director quarantine limits are enforced and directly tested.
4. **Authorization still assumes one organization.** `organizationId` is validated as `redeemer-house`, while several organization-wide queries use an explicit `TRUE` boundary because business tables do not carry organization IDs. This is acceptable only for the approved single-organization launch.
5. **Local signed bearer principals are test-only.** Production rejects credentials that do not map to a revocable database session. Running production with development configuration would weaken that boundary and must remain a deployment check.

## MISSING SERVER-SIDE CHECKS

The following are documented as absent rather than silently treated as implemented:

- **Document category policy:** current schemas store free-text categories; there is no approved per-role category allowlist to enforce. Existing subject/house/sharing/status checks remain mandatory.
- **Malware-scan attestation:** no scan result, scanner identity, quarantine reason, or immutable approval transition is stored. Resident metadata and downloads therefore permit only pre-existing `approved` records and otherwise omit or return not-found.
- **Resident document uploads:** required by the target operating model but not implemented in the mounted application. The present upload URL and metadata creation flow is staff-only.
- **Resident self-service field allowlist:** resident profile edits are currently denied entirely. Adding self-service fields requires separate request DTOs and response shaping.
- **Medication, UA results, and dedicated recovery/case-plan APIs:** absent.
- **Payment correction, bank-return reversal, QuickBooks, and card-processing checks:** absent because those product features are not mounted.
- **Deletion/quarantine HTTP authorization:** absent because no deletion endpoint is mounted. Existing retention helpers are not an authorization boundary.
- **Per-category document response DTOs:** metadata is scoped by resident and sharing state, but category-specific field minimization cannot be implemented until categories are approved.
- **Multi-organization row predicates:** absent by approved launch design; every expansion beyond Redeemer House requires organization keys on business records and queries.

## Authentication lifecycle evidence

| Control | Effective behavior | Evidence |
|---|---|---|
| Registration and recovery enumeration | Registration, verification request, password-reset request, and failed login use uniform responses. Login performs a dummy password verification for unknown accounts. | `routes/auth.ts`; auth lifecycle integration |
| Password handling | Scrypt password hashes; policy requires at least 12 characters with upper/lowercase and number. Raw passwords are neither stored nor logged. | `lib/account-security.ts`; logger redaction; auth lifecycle integration |
| Session creation | Successful login creates a random session ID, stores only the token HMAC, and returns an HttpOnly `__Host-` cookie. | `routes/auth.ts`; `middlewares/auth.ts` |
| Cookie flags | `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`; 30-day browser maximum. | Authorization regression and code assertion |
| CSRF | Mutating cookie requests require an approved `Origin`; unknown and missing origins are rejected. Bearer-only non-browser calls do not inherit cookie CSRF risk. | `authorization.test.mjs` |
| Idle / absolute expiry | 12-hour rolling idle expiry capped by a 30-day absolute expiry; both are queried from the DB. | `principalFromSession`; auth lifecycle integration |
| Revocation | Logout, password reset, role/house assignment, deactivation, and explicit administrator revocation invalidate database sessions. | auth lifecycle integration |
| Rotation / replay | Every login creates a new random session. A revoked token cannot be replayed because every production request checks the stored hash and `revokedAt`. | auth lifecycle integration |
| Malformed credentials | Invalid bearer/cookie signatures, expired tokens, and malformed percent-encoded cookies return uniform `401` without stack/SQL details. | `authorization.test.mjs`; safe error middleware |
| Frontend expiry | Bootstrap remains fail-closed; 401 or timer expiry clears user state and the full query cache; logout clears state even if the request fails. | `src/lib/auth.tsx`; web build |

## Regression and release evidence

The focused suite for this audit is:

```text
pnpm --filter @workspace/api-server run test:auth-lifecycle
pnpm --filter @workspace/api-server run test:authorization
pnpm --filter @workspace/api-server run test:documents
pnpm --filter @workspace/api-server run test:assessments
pnpm --filter @workspace/api-server run test:reports
pnpm --filter @workspace/api-server run test:security
pnpm run codegen:check
pnpm run typecheck
pnpm run security:release-gate
```

The release gate remains a guardrail, not proof by itself. This report and the direct lower-privilege requests are the evidence for effective role and resource behavior.