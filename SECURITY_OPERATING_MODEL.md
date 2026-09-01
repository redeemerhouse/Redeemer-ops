# ONEsource Security Operating Model

**Status:** Approved product operating model  
**Approved for implementation planning:** 2026-08-25  
**Applies to:** ONEsource Recovery Operations, Redeemer House

This document is the product-policy source of truth for authentication, authorization,
resident and household data, documents, payments, exports, notifications, retention, and
operational response. It resolves the product-owner decisions identified in
`threat_model.md`. It does not itself implement an identity provider, route middleware,
database migrations, audit storage, or deletion jobs.

Implementation work must enforce this model on the server. The browser, generated client,
OpenAPI descriptions, and database defaults are not authorization boundaries.

## 1. Tenancy, housing, and roles

### Tenancy

- The launch has one organization: Redeemer House.
- The organization contains multiple managed houses. A house is a service boundary, not
  a separate tenant.
- Houses contain rooms and labeled beds. Bed records track availability, holds, current
  assignment, and whether the bed supports individual or family occupancy.
- A staff member may be assigned to one or more houses. Scope is derived from the
  authenticated account; a client-supplied house or organization value is never trusted.
- A resident has one current service-house assignment. Transfers close the old assignment
  and create a new assignment with an effective date and actor audit event.
- Capacity is calculated from approved beds and occupancy rules, not from client-submitted
  counts. Family occupancy consumes the configured family capacity for the bed/room.

### Roles

| Role | Scope | Authority |
|---|---|---|
| `owner_admin` | Entire organization | Super-admin. All operational records, account approval/assignment, lifecycle and housing administration, audit review, exports, deletion authorization, quarantined-record restoration, permanent deletion, and policy configuration. |
| `program_director` | Entire organization | Broad operational authority for exports and day-to-day operations. May manage residents, housing, payments, documents, operations, and audits, and may request or move records into deletion quarantine. May not restore a quarantined record or permanently delete a record. This role does not change organization ownership or policy without owner-admin authority where separately required. |
| `house_manager` | Assigned house(s) | Work with women assigned to an assigned house: operational resident records, assignments/transfers, exit, discharge, and reactivation, notes, documents within role/category policy, attendance, and payment records. Other-house visibility is limited to approved bed availability and directory names/contact information; no other-house notes, health, legal, financial, payment, document contents, or operational history. |
| `resident` | Own resident/household record | Read and contribute to the resident-facing resources listed in section 4. No access to another resident, staff-only notes, other-house data, audit records, exports, or deletion. |

Deletion authority is intentionally split: a program director may request or perform the
initial move into deletion quarantine, but only an owner admin may restore a quarantined
record or permanently delete it. Neither role is exempt from audit, quarantine, validation,
or incident review.

### Permission matrix

`Own` means the resident’s authenticated self record and the household record attached to
it. `Assigned` means a woman assigned to a house in the manager’s server-derived scope.

| Action / data | Owner admin | Program director | House manager | Resident |
|---|---|---|---|---|
| Read/edit general resident record | All | All | Assigned; other-house directory only | Own read; approved self-service fields only |
| Activate, exit, discharge, reactivate, or correct lifecycle | All | All | Exit, discharge, or reactivate assigned residents; request/recommend activation or correction | No |
| Assign bed, place, hold, or transfer | All | All | Assigned houses | No |
| Read/write payment records | All | All | Assigned residents | Own balance/read; submit permitted confirmation, never authoritative status |
| Read/write notes | All subject to category policy | All subject to category policy | Assigned residents and role-permitted categories | Own resident-visible notes only |
| Read/upload documents | All subject to category policy | All subject to category policy | Assigned residents and role-permitted categories | Own shared documents; upload allowed categories; no delete |
| Read/write attendance and attendance photos | All | All | Assigned houses | Own attendance; upload/view photos allowed by sharing policy |
| Read UA/drug-screening results | All | All | Assigned residents | Own results only |
| Read audit history | All | All | Only events needed for assigned operational work, with sensitive values minimized | No |
| Export reports | Yes | Yes | No | No |
| Request or move to deletion quarantine | Yes | Yes | No | No |
| Restore quarantined record or permanently delete | Yes | No | No | No |

Every action also requires an active account, organization membership, and resource scope.
A forbidden resource must return the agreed uniform authorization/not-found behavior rather
than disclosing whether an inaccessible record exists.

## 2. Identity and session policy

- Authentication is email/password. Microsoft sign-in, SSO, and other identity providers
  are not part of the approved launch posture.
- Staff and resident self-registration may create only an unapproved account. An owner
  admin or program director must approve the account, assign its role, and assign its
  house scope before access is granted.
- On an empty database, an operator provisions the first owner administrator exactly once
  with `POST /api/auth/bootstrap`, a valid email/password body, and the server-side
  `SESSION_SECRET` supplied in the `X-Initial-Admin-Token` header. The route takes a
  transaction-scoped advisory lock, fails closed when any account already exists, never
  accepts the bootstrap credential in a URL, and never returns a session or credential.
  After provisioning, the owner signs in normally and all later accounts use the approval
  workflow.
- No user may self-select, escalate, or broaden a role, organization, household, or house
  assignment. These fields are server-administered.
- Email verification is required before activation. Password recovery uses a
  single-use, time-limited token and revokes active sessions after a successful reset.
- Sessions use secure, server-managed credentials: `httpOnly`, `secure` in production,
  deliberate `SameSite`, origin/CSRF protections, and no sensitive tokens in URLs or
  browser persistent storage.
- Default session lifetime is 12 hours of inactivity and 30 days absolute. Logout,
  administrator revocation, account deactivation, password reset, and suspected
  compromise revoke active sessions. Exact provider settings must preserve these limits.
- Failed login responses are uniform. Apply progressive rate limiting after five failures
  in 15 minutes per account/IP combination, without revealing whether an email exists.
- Deactivated staff lose access immediately. Deactivated residents lose portal access
  immediately while their records remain governed by lifecycle and retention policy.
- MFA is **not required by current product policy**. This is an accepted launch risk,
  not evidence that MFA is prohibited; the policy must be revisited if threat,
  insurance, legal, or operational requirements change.

## 3. Resident, household, and housing lifecycle

### Resident lifecycle

The canonical states are exactly:

- `pending`: intake/application exists or account is awaiting operational activation;
  no active placement or normal resident portal access.
- `active`: approved resident with an active placement or approved operating relationship;
  normal staff and resident access applies.
- `exited`: resident has left the program; placement is closed and operational access is
  removed or reduced to approved historical access.
- `discharged`: organization has formally ended the resident relationship for a
  documented discharge reason; no new operational activity is permitted.

Valid transitions are `pending -> active`, `active -> exited`, `active -> discharged`,
and `exited -> active` only as a documented administrative re-entry that creates or
reopens an approved placement. `discharged` is terminal for launch. A correction does not
rewrite history; it creates an audited correction.

Owner admin and program director may perform lifecycle transitions across the
organization. House managers may execute exit, discharge, and reactivation only for
residents in their assigned, server-derived house scope. They cannot act outside that
scope, restore records, delete records, or widen scope. Residents cannot change lifecycle
state.

Discharge requires a recorded reason before the transition is committed. Every lifecycle
transition, including a house-manager transition and an administrative correction, creates
an audit event; a correction does not rewrite the prior transition history.

Activation requires approval and any required placement checks. Bed assignment is a
separate server-side action and must respect availability, eligibility, capacity, and
family occupancy. Payment collection is allowed for `active` residents and for
approved closing balances; it does not itself activate a resident or set payment status.

### Households and families

- A mother and her children are one household record. Children are included under the
  mother’s profile and are not separate resident accounts or separate portal identities.
- Staff access to child details follows the mother’s service-house and role scope.
- Family milestones may be updated only through approved resident self-service fields or
  authorized staff actions; a child cannot independently authenticate against the record.
- A household transfer moves the household assignment atomically and preserves prior
  assignment history.

### Data classification and visibility

| Data category | Staff access | Resident access |
|---|---|---|
| General profile, contact, placement, bed/room, status | Role and house scope | Own approved fields |
| Medication, recovery goals/plans, treatment/recovery notes | Assigned service-house roles and administrators; category restrictions apply | Own recovery plans and explicitly shared content |
| Sensitive financial documents, balances, payment records | Administrators all; managers assigned scope | Own balance and approved payment actions, not staff-only financial documents |
| Legal/court contacts and referrals | Assigned service-house roles and administrators | Only explicitly shared resident-facing content |
| Notes | Service-house and category/role scoped; staff-private notes never resident-visible | Only resident-visible notes on own record |
| Documents | Category and service-house scoped; sharing is explicit | Own documents shared under category policy |
| Attendance and meeting records | Relevant assigned staff and administrators | Own attendance and permitted meeting attendance |
| Attendance photos | Relevant house staff and administrators; sharing/retention policy applies | Own permitted photos |
| UA/drug-screening results | Assigned service-house roles and administrators | Own results only |

Responses must be role-shaped. A record being in an accessible row does not authorize
returning every column.

## 4. Portal, documents, and attendance controls

- Residents may view their own recovery plans, explicitly shared documents, organization
  and team hub resources, meeting attendance, permitted attendance-photo uploads, and
  their own UA/drug-screening results.
- Residents may upload only approved document categories and attendance photos through
  bounded, authenticated endpoints. Staff uploads are scoped to the staff member’s
  assigned service house and permitted categories.
- Every document has an owner/subject, service house, category, sharing state, uploader,
  upload timestamp, malware-scan result, and immutable upload history.
- Malware scanning must complete before a document becomes available to another user.
  Failed, unknown, or quarantined scans are not downloadable.
- Uploaded files are immutable. Users, including residents, cannot delete uploads or
  erase upload history. Owner admins and program directors may request or move a document
  record into the deletion quarantine; only an owner admin may restore it or permanently
  delete it under section 6.
- Sharing a document with a resident is an explicit category-level decision; staff-private
  documents remain staff-private. A shared resource must not expose unrelated metadata.
- Attendance photos are operational records, not a general social gallery. Access is
  limited to the applicable house/team and the resident-facing sharing policy. They
  follow record retention and deletion controls; deletion is never a user self-service
  action.

## 5. Money and integration boundaries

- Currency is USD. Store and calculate money as exact decimal values with two decimal
  places (or integer cents internally); never use binary floating-point as the authority.
- Payments are operational records. The server derives balance, payment status, resident
  name, and other calculated fields from persisted records and approved rules.
- Partial payments are supported and reduce the outstanding balance without falsely
  marking the obligation paid. Reason-coded credits are supported and must include a
  controlled reason and actor audit event.
- Refunds are not supported. A correction is an audited reversal/correction, not a refund.
- A reversal is allowed only for a confirmed bank return. It reverses the original
  payment and adds a $50.00 returned-payment fee as a separate reason-coded charge.
- Residents may submit payment confirmations or permitted online payment actions, but
  cannot set paid status, alter amount, change resident ownership, or erase a payment.
- Owner admin and program director may administer payment corrections within policy;
  house managers may work only within assigned resident scope.
- QuickBooks synchronization implementation remains deferred until a separate
  implementation task. The transaction policy below is the approved pre-implementation
  decision for the bookkeeper and owner-admin review.

#### QuickBooks transaction decision record

**Decision status:** Approved for future implementation; no QuickBooks routes,
credentials, or synchronization jobs are authorized by this document.

**Included transaction types**

- **Payments:** confirmed resident rent and approved move-in-fee payments, including
  partial payments. A resident-submitted payment confirmation is not an accounting
  event until an authorized staff member or an approved payment provider marks it
  confirmed.
- **Credits:** reason-coded credits that reduce a resident balance. Credits are
  accounting adjustments, not refunds, and must retain their actor audit event.
- **Returned-payment fees:** a confirmed bank return reverses the original payment
  and creates one separate $50.00 returned-payment-fee charge. The reversal and fee
  are exported as linked events.
- **Corrections:** audited corrections and reversals of an exported event. The
  original event is never edited or deleted; a linked adjustment is exported instead.

Unpaid scheduled obligations, unverified payment confirmations, refunds, card data,
donations/fundraising, and other transaction types are excluded from the initial
QuickBooks boundary. Refunds remain unsupported by product policy.

**System of record:** ONEsource is authoritative for resident ownership, operational
payment facts, confirmation state, credits, bank-return events, corrections, and
the immutable event history. QuickBooks is the downstream accounting ledger and is
authoritative only for its own posting identifiers and general-ledger presentation.
QuickBooks must not create, overwrite, or change an ONEsource payment or balance.

**Sync direction and processing behavior:** The initial integration is one-way,
from ONEsource to QuickBooks. Only finalized, approved events are sent. Each
source event is exported once using a stable ONEsource event identifier as the
idempotency key, and the resulting QuickBooks posting identifier and outcome are
recorded back in ONEsource without changing the source amount or business meaning.

**Conflict handling:** A matching source event and QuickBooks posting with the same
idempotency key is treated as the same export only when the amount, currency,
transaction type, and resident-safe accounting mapping match. A duplicate with
different values, a missing expected posting, or an unmapped account is blocked
from automatic resolution, flagged for administrator/bookkeeper reconciliation,
and preserved with its audit trail. The integration never silently overwrites
either system.

**Retry behavior:** Transient transport or QuickBooks availability failures retry
automatically with bounded exponential backoff and the same idempotency key. After
five unsuccessful attempts, the event moves to a durable manual-reconciliation
queue and generates an administrator alert; it is never dropped or recreated under
a new key. Validation, authorization, mapping, and conflict failures do not retry
until corrected and explicitly requeued.

## 6. Retention, deletion, audit, and operations

### Deletion and quarantine

- Records are retained until deletion is requested or authorized, subject to legal hold,
  investigation, payment reconciliation, and operational needs. A program director may
  request or perform the initial move of a record and its permitted dependent data into an
  inaccessible 15-day archive/quarantine. An owner admin may also request or perform that
  move.
- The actor, reason, timestamp, scope, and target are recorded before the move. During
  quarantine, no normal user can read the data. Only an owner admin may restore a
  quarantined record, cancel the deletion, or permanently delete it, and each action
  requires an audited reason.
- After 15 days, elapsed quarantine time establishes eligibility for review; it does not
  authorize permanent deletion by itself. An owner admin must record permanent-deletion
  approval after reviewing the quarantined target and active holds. Only a deletion job
  that verifies that owner-admin approval may permanently remove the approved record and
  dependent copies, excluding required audit history and legally required evidence.
  Foreign-key and export behavior must be defined per record type before implementation.
- A legal hold or active investigation pauses permanent deletion. Deletion must never
  remove or rewrite the audit event that proves the authorization and outcome.

### Audit and backups

- Audit events cover authentication outcomes, account/role/scope changes, resident
  lifecycle and placement changes, payment creation/correction/reversal/credit,
  document upload/share/scan/quarantine/delete, exports, and administrative deletion.
- Events include actor, action, target type/identifier, organization/house scope,
  timestamp, correlation ID, outcome, and minimal before/after metadata. Do not put
  resident notes, document contents, raw payment payloads, credentials, or tokens in
  audit or routine logs.
- Audit history is restricted to administrators, with limited assigned-scope operational
  views for house managers. It remains reviewable after source-record deletion and is
  retained for at least seven years after the event, or longer when a legal hold or
  applicable record obligation requires it. The seven-year minimum is an accepted
  operating default.
- Use encrypted daily backups with access restricted to operators and the service.
  Retain a rolling operational window of at least 35 days, an accepted operating default;
  test restoration regularly, and require an approved, audited restore procedure.
  Restores must not silently reintroduce quarantined or deleted data.
- Logs, exports, backups, and scans are separate sensitive stores. They use least
  privilege, documented retention, and redaction; no raw resident/payment payloads or
  secret values are logged.

### Notifications and incidents

- Email, SMS, and in-app channels are available. Templates contain only generic prompts,
  dates, action links, and non-sensitive status. They must not include diagnoses,
  medication, recovery details, legal information, payment amounts, document names,
  UA results, or detailed resident information.
- Sensitive details are shown only after authenticated access to the portal. Delivery
  failures must not expose message contents in errors or logs.
- Owner admin owns organization-level production decisions; program director owns daily
  operational response; house managers report issues within their assigned scope.
- Treat suspected unauthorized access, cross-house disclosure, role escalation, payment
  tampering, malware bypass, export leakage, or notification of sensitive details as a
  security incident requiring immediate access containment, evidence preservation, and
  administrator review. Availability incidents that prevent staff from safely managing
  placements or payments also require escalation.

## 7. Launch scope

### Must have for launch

- One organization with multiple houses, rooms, beds, assignments, family capacity,
  transfers, vacancies, and the four resident lifecycle states.
- Email/password authentication with verification, approval/assignment, session
  revocation, safe recovery, and the approved role/scope model.
- Server-side validation, scoped queries, role-shaped responses, audit events, and safe
  errors before sensitive routes are exposed.
- Resident intake/profile, resident portal self-scope, operational notes, approved
  documents with scanning and immutable upload history, attendance/UA result policy,
  payments with partial payments/credits/bank-return fee behavior, and administrator
  CSV/PDF exports.
- 15-day deletion quarantine, audit review, secure daily backups, and generic
  multi-channel notifications.

### Deferred pending explicit decision

- QuickBooks synchronization or any accounting integration.
- QuickBooks synchronization implementation, including provider-specific account
  mapping and credentials; the transaction policy above is approved, but the
  integration itself remains a separate launch gate.
- Any identity provider, SSO, or MFA requirement beyond the approved email/password
  posture.
- Production migration/import until source mapping and reconciliation are approved.

### Explicitly out of scope for this launch

- GPS tracking, a full clinical EHR, separate child profiles/accounts, automated
  document-expiration alerts, full donation/fundraising tracking, and advanced mobile
  applications.
- Card-data storage or payment-processor implementation.
- User-management UI, invitation workflow, or building an identity provider as part of
  this operating-model task.

## 8. Implementation gate

Before any sensitive route is exposed, the implementation task must point to this
document and demonstrate:

1. authenticated principal and active-session checks;
2. centralized role/action/resource-scope authorization;
3. server-side allowlists and validation for params, body, query, and responses;
4. organization/house/resource-scoped database access;
5. server-authoritative lifecycle, placement, balance, payment, and sharing behavior;
6. safe error and log redaction behavior;
7. audit coverage for high-impact reads/writes and exports;
8. focused tests for horizontal access, vertical privilege escalation, mass assignment,
   document sharing, payment tampering, deletion quarantine, and export permissions.

Any feature not covered here is deferred until its policy is recorded and approved; it
must not invent an authorization or retention rule in route code.