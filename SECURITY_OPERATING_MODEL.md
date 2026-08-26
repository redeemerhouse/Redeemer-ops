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
| `owner_admin` | Entire organization | Super-admin. All operational records, account approval/assignment, lifecycle and housing administration, audit review, exports, deletion authorization, and policy configuration. |
| `program_director` | Entire organization | Broad operational authority equivalent to owner admin for exports and deletion. May manage residents, housing, payments, documents, operations, and audits. This role does not change organization ownership or policy without owner-admin authority where separately required. |
| `house_manager` | Assigned house(s) | Work with women assigned to an assigned house: operational resident records, assignments/transfers, notes, documents within role/category policy, attendance, and payment records. Other-house visibility is limited to approved bed availability and directory names/contact information; no other-house notes, health, legal, financial, payment, document contents, or operational history. |
| `resident` | Own resident/household record | Read and contribute to the resident-facing resources listed in section 4. No access to another resident, staff-only notes, other-house data, audit records, exports, or deletion. |

“Equivalent export/deletion authority” means owner admin and program director receive the
same export and deletion permission; it does not make either role exempt from audit,
quarantine, validation, or incident review.

### Permission matrix

`Own` means the resident’s authenticated self record and the household record attached to
it. `Assigned` means a woman assigned to a house in the manager’s server-derived scope.

| Action / data | Owner admin | Program director | House manager | Resident |
|---|---|---|---|---|
| Read/edit general resident record | All | All | Assigned; other-house directory only | Own read; approved self-service fields only |
| Activate, exit, discharge, or correct lifecycle | All | All | Request/recommend; may perform approved operational transitions in assigned scope | No |
| Assign bed, place, hold, or transfer | All | All | Assigned houses | No |
| Read/write payment records | All | All | Assigned residents | Own balance/read; submit permitted confirmation, never authoritative status |
| Read/write notes | All subject to category policy | All subject to category policy | Assigned residents and role-permitted categories | Own resident-visible notes only |
| Read/upload documents | All subject to category policy | All subject to category policy | Assigned residents and role-permitted categories | Own shared documents; upload allowed categories; no delete |
| Read/write attendance and attendance photos | All | All | Assigned houses | Own attendance; upload/view photos allowed by sharing policy |
| Read UA/drug-screening results | All | All | Assigned residents | Own results only |
| Read audit history | All | All | Only events needed for assigned operational work, with sensitive values minimized | No |
| Export reports | Yes | Yes | No | No |
| Authorize deletion/quarantine | Yes | Yes | No | No |

Every action also requires an active account, organization membership, and resource scope.
A forbidden resource must return the agreed uniform authorization/not-found behavior rather
than disclosing whether an inaccessible record exists.

## 2. Identity and session policy

- Authentication is email/password. Microsoft sign-in, SSO, and other identity providers
  are not part of the approved launch posture.
- Staff and resident self-registration may create only an unapproved account. An owner
  admin or program director must approve the account, assign its role, and assign its
  house scope before access is granted.
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
organization. House managers may perform only explicitly delegated operational actions
for assigned residents; they cannot discharge, delete, or widen scope. Residents cannot
change lifecycle state.

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
  erase upload history. Authorized owner admins and program directors can delete a
  document record only through the deletion quarantine in section 6.
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
- QuickBooks integration is deferred. No QuickBooks synchronization, card-data
  processing, or accounting system-of-record assumption is approved until the bookkeeper
  confirms transaction mapping, included transaction types, processing behavior,
  conflict rules, and system of record.

## 6. Retention, deletion, audit, and operations

### Deletion and quarantine

- Records are retained until an owner admin or program director authorizes deletion,
  subject to legal hold, investigation, payment reconciliation, and operational needs.
- Authorized deletion first moves the target record and its permitted dependent data into
  an inaccessible 15-day archive/quarantine. The actor, reason, timestamp, scope, and
  target are recorded before the move.
- During quarantine, no normal user can read or restore the data. An owner admin or
  program director may cancel the deletion during the quarantine with an audited reason.
- After 15 days, the deletion job permanently removes the approved record and dependent
  copies, excluding required audit history and legally required evidence. Foreign-key
  and export behavior must be defined per record type before implementation.
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
  applicable record obligation requires it.
- Use encrypted daily backups with access restricted to operators and the service.
  Retain a rolling operational window of at least 35 days, test restoration regularly,
  and require an approved, audited restore procedure. Restores must not silently
  reintroduce quarantined or deleted data.
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
- Final accounting transaction mapping, system-of-record and conflict rules.
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