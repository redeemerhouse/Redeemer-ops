# Resident Lifecycle Assessment

**Assessment date:** 2026-09-04  
**Status:** Approved implementation guidance  
**Policy baseline:** `SECURITY_OPERATING_MODEL.md`  
**Scope:** Inquiry through alumni follow-up and reapplication for ONEsource Recovery Operations

This assessment documents current behavior and defines the lifecycle model that database,
API, and user-interface work must share. It does not change production behavior. Where
this document conflicts with an implementation default or editable browser field, the
approved security operating model and the server-enforced rules below take precedence.

The browser, generated client, OpenAPI description, database default, and free-text status
field are not lifecycle or authorization boundaries.

## 1. Executive decision

ONEsource needs two related but distinct state machines:

1. an **application pipeline**, from inquiry through disposition or conversion; and
2. a **resident lifecycle**, limited to the four states already approved by policy:
   `pending`, `active`, `exited`, and `discharged`.

Application stage must not be copied into resident status. Placement, bed occupancy,
temporary absence, staff assignment, milestones, alumni follow-up, and reapplication are
related records with their own dates and history; they are not additional resident states.

Every state change must use a dedicated server operation that:

- checks the authenticated actor, current state, target state, and resource scope;
- validates required reasons, notes, and effective dates;
- updates the current projection and appends immutable domain history in one transaction;
- records minimal before/after audit evidence and a correlation ID;
- preserves earlier events instead of rewriting them; and
- returns not-found behavior for inaccessible records.

Generic resident PATCH must no longer change lifecycle state, placement, house, bed,
move-in date, or exit/discharge facts after transition endpoints are available.

## 2. Current-state workflow map

| Stage | Current database behavior | Current API behavior | Current staff experience | Effective result |
|---|---|---|---|---|
| Inquiry | No inquiry/contact entity. | No inquiry endpoint. | Staff may start an application immediately. | Informal inquiries are outside the system; source and initial contact evidence are incomplete. |
| Application | `applications` stores identity, preferred house, intake JSON/text, acknowledgment, free-text status, source, and optional converted resident link. | Staff can list, create, and edit allowlisted intake fields. Application routes are not represented in OpenAPI. | Operations shows a read-only list and a small create modal. | An application can be created, but there is no supported stage workflow. |
| Review | Checklist and sensitive intake fields exist, but no reviewer assignment or stage history exists. | PATCH replaces intake fields and emits a generic update audit event. | No application detail or review action. | Review is implicit in mutable fields and off-system coordination. |
| Waitlist | No waitlist entry, priority, requested date, expiry, or history. | No waitlist operation. | No queue or action. | Waitlisting can only be represented by an ungoverned status/manual edit. |
| Interview | No interview entity, schedule, outcome, or interviewer. A generic operation requires a resident, not an applicant. | No applicant interview operation. | No interview workflow. | Interviews occur outside the modeled application record. |
| Placement | Application has only a preferred house. Resident has required free-text `home`; no room, bed, or assignment history. | Resident creation accepts a house name and move-in date. No application conversion or placement transaction exists. | Staff can directly create a resident and type a home. Houses show calculated counts, not bed assignments. | Preference, approval, admission, and physical occupancy can diverge. |
| Residency | Resident has `status`, unused/unconstrained `lifecycleState`, move-in date, balance, notes, and free-text home. | Generic PATCH directly edits profile, status, home, and dates; audit evidence is generic. | Directory/detail forms expose status, home, move-in date, and notes. | Current state is mutable without transition evidence. |
| Temporary absence | No absence entity or date range. Generic operations are point-in-time tasks. | No leave/return operation. | No absence workflow. | Staff cannot distinguish temporary absence from exit or occupancy. |
| Transfer | No house/bed assignment history. | Updating `home` performs an unrecorded transfer-like edit after source/target scope checks. | Staff type another home in the edit form. | Prior assignment, effective date, bed release, and transfer reason are lost. |
| Exit | Resident status allows `exited`, but there is no exit date, reason, destination, closing checklist, or placement close. | Generic PATCH can set `exited`. | Status dropdown changes the record directly. | Exit is not an auditable operational transaction. |
| Discharge | `discharged` is approved by policy but rejected by the current resident status constraint and OpenAPI enum. | No discharge operation. | No discharge action. | Approved policy cannot currently be represented safely. |
| Alumni follow-up | No alumni profile, contact consent, follow-up schedule, outcome, or task linkage. | Reports expose roster/status only. | No alumni list or workspace. | Alumni coordination occurs outside the system. |
| Reapplication/re-entry | No relationship from a new application to a prior resident/application. | No reapply/reactivate operation. | No reapplication flow. | Duplicate records are likely and prior history is hard to discover. |

### Supporting operational records

- **Documents:** the schema can represent exactly one application or resident owner, but
  the mounted creation route rejects client application ownership, requires a resident,
  and forces `applicationId` to null. Manager listing/history is also resident-scoped.
  Application documents therefore have no supported current API/UI workflow. A future
  intake-document contract must authorize and scope the application independently before
  conversion can intentionally retain or associate those records. Approval/scanning and
  category policy remain separate work.
- **Assessments:** submissions are resident-oriented; there is no application assessment
  relationship. Template versioning exists, but assessments do not drive lifecycle state.
- **Payments:** are resident-owned and create-only. A paid entry changes cached balance,
  but payment must never activate, exit, discharge, transfer, or readmit a resident.
- **Meetings:** are house-level aggregate attendance, not resident-level attendance.
  They cannot prove an individual absence or lifecycle milestone.
- **Generic operations:** can schedule resident tasks and private notes but cannot replace
  typed lifecycle, placement, absence, or milestone records.
- **Imports:** create residents directly and accept both `status` and arbitrary
  `lifecycleState`; they bypass an application/conversion workflow and provide only
  batch-level audit evidence.

## 3. Gaps and risks

| Priority | Gap or risk | Consequence | Required control |
|---|---|---|---|
| Critical | Resident state, house, and dates are direct-edit fields. | History can be overwritten; occupancy, access, and reports can become inconsistent. | Dedicated transition/placement operations; remove protected fields from generic PATCH. |
| Critical | No application-to-resident conversion transaction. | Duplicate residents, orphan applications/documents, and partial placement are possible. | Idempotent conversion with duplicate review, placement checks, linkage, and co-committed history. |
| High | `status` and `lifecycleState` overlap and disagree. | APIs, imports, reports, and UI can interpret different truths. | Make resident `status` the four-state projection; retire `lifecycleState` after reconciled backfill. |
| High | Application status is unconstrained and has no transition API. | Unknown stages and direct SQL edits become operational truth. | Controlled application stages, transition history, and DB checks after cleanup. |
| High | House assignment is mutable text and beds do not exist. | Transfers lose history; occupancy is not authoritative; duplicate house names are ambiguous. | Stable house relationship plus room/bed and dated assignment records. |
| High | Exit/discharge evidence is absent. | Staff cannot prove who acted, why, when access ended, or whether a bed closed. | Required reason code, effective date, note rules, closing checks, domain event, and audit event. |
| High | Duplicate rules differ by entry path. | Applications and imported/direct residents may represent the same person. | Shared normalized identity candidates and transactional recheck across create, import, conversion, and reapply. |
| High | Audit events are generic and not guaranteed to commit with every business mutation. | Forensics may show an update without the lifecycle meaning or omit a partially completed flow. | Transactional domain history plus minimal correlated audit evidence. |
| Medium | Absence is not modeled separately. | Temporary leave may incorrectly free a bed, revoke access, or look like exit. | Dated absence episodes that leave resident state and occupancy policy explicit. |
| Medium | Alumni and reapplication are absent. | Follow-up is lost and returning residents are duplicated. | Alumni follow-up records and reapplication links to the existing person/resident record. |
| Medium | Application routes are outside OpenAPI and UI sends ignored fields. | Browser behavior and server contract drift silently. | Add application/lifecycle contracts to OpenAPI and generated clients before UI rollout. |
| Medium | Import allows arbitrary lifecycle text and only batch-level resident creation audit. | Invalid states and weak provenance enter through a privileged bulk path. | Restrict import to approved baseline states; append one baseline event per created resident. |
| Medium | Reports count active residents by mutable home/status. | Capacity and alumni results may be wrong. | Derive occupancy from active assignments; define report inclusion by canonical state and dates. |

### Overlap boundaries

This lifecycle work must coordinate with, but not implement:

- **Payments and QuickBooks:** lifecycle transitions may require a closing-balance review
  result, but must not edit, reverse, reconcile, or synchronize a payment.
- **Documents:** lifecycle may require named checklist outcomes and preserve ownership
  across conversion, but upload, scanning, category access, and deletion remain separate.
- **Meeting cadence:** absence and placement dates provide eligibility boundaries, but
  expected cadence and missed-meeting alerts remain separate.
- **Stable house relationships:** placement depends on stable house IDs. The migration
  sequence must avoid competing resident-house columns or duplicate backfills.
- **Retention/deletion:** exited and discharged records are retained operational records,
  not deleted or quarantined records.
- **Authentication:** resident portal access follows account/session policy and lifecycle
  decisions, but lifecycle state changes must not mutate account roles or credentials.

## 4. Approved application model

### Application stages

| Stage | Meaning |
|---|---|
| `inquiry` | Minimal contact/referral captured; intake not yet submitted. |
| `draft` | Intake is being prepared and is not ready for staff review. |
| `submitted` | Required applicant acknowledgment and intake fields are present. |
| `under_review` | An authorized staff member has accepted the application for review. |
| `waitlisted` | Applicant is eligible to remain in queue, but placement is not currently offered. |
| `interview_scheduled` | An interview appointment exists. |
| `interviewed` | Interview outcome and date are recorded; disposition remains pending. |
| `approved` | Program eligibility is approved; this does not itself create occupancy. |
| `placed` | Conversion and initial placement succeeded; the application is linked to the resident. |
| `declined` | Organization declined the application with a controlled reason. |
| `withdrawn` | Applicant/referrer ended the application or stopped responding, with reason. |
| `expired` | Time-limited application or waitlist eligibility ended under an approved rule. |

`placed`, `declined`, `withdrawn`, and `expired` are terminal for that application record.
Reconsideration creates a new application linked as a reapplication; it does not erase or
reopen the terminal history. An administrative correction appends a correction event and
updates the projection only when owner admin or program director supplies a reason.

### Application transitions

| From | To | Actors | Required evidence |
|---|---|---|---|
| none | inquiry, draft | owner admin, program director; scoped house manager may create intake for a preferred house in scope | source; received date; identity/contact available at that point |
| inquiry | draft, submitted, withdrawn | owner admin, program director | effective date; withdrawal reason when applicable |
| draft | submitted, withdrawn | owner admin, program director | acknowledgment; required intake fields; effective date |
| submitted | under_review, withdrawn | owner admin, program director | reviewer; review-start date; withdrawal reason when applicable |
| under_review | waitlisted, interview_scheduled, approved, declined, withdrawn | owner admin, program director | effective date; controlled reason for waitlist/decline/withdrawal; interview date when scheduled; note for exceptions |
| waitlisted | interview_scheduled, approved, declined, withdrawn, expired | owner admin, program director | queue date/priority source; effective date; reason for removal; no silent reprioritization |
| interview_scheduled | interviewed, waitlisted, withdrawn | owner admin, program director | scheduled date; outcome/no-show/reschedule reason; interviewer |
| interviewed | waitlisted, approved, declined, withdrawn | owner admin, program director | interview date/outcome; disposition reason where applicable |
| approved | placed, waitlisted, withdrawn, expired | owner admin, program director | approval date/actor; placement date; selected house/bed; exception reason if returning to waitlist |
| terminal | correction only | owner admin, program director | correction reason; reference to superseded event; no history deletion |

Application stage authority is intentionally conservative because the approved operating
model does not grant house managers intake disposition authority. House managers may
create and edit allowlisted intake facts for an application whose preferred house is in
their server-derived scope and record a recommendation without changing stage. Any future
manager stage transition requires an explicit policy amendment, a closed action
permission, source/target scope checks, and regression tests.

## 5. Approved resident model

The canonical resident states remain exactly those in `SECURITY_OPERATING_MODEL.md`:

- `pending`: intake/application exists or an account/operational resident record is
  awaiting activation; there is no active placement or normal resident portal access;
- `active`: approved relationship with an active placement or explicitly approved active
  operating relationship;
- `exited`: resident left the program through a non-discharge exit;
- `discharged`: organization formally ended the relationship for a documented discharge
  reason; terminal for launch.

Application-only people should normally not have a resident row. A resident created during
legacy import may begin `pending`, but `lifecycleState='applicant'` must not remain a second
state authority.

### Resident transition matrix

| From | To | Permitted actors | Required data and checks | Transactional effects |
|---|---|---|---|---|
| none | pending | owner admin, program director; scoped house manager through approved conversion/import only | source application/import; duplicate review; effective date; creation reason | create resident projection and baseline history; preserve source link |
| pending | active | owner admin, program director | activation date; approved application or administrative reason; available eligible bed/assignment; required checklist outcomes | append transition; open placement/occupancy; audit; evaluate portal access separately |
| active | exited | owner admin, program director, current assigned-house manager | exit date; controlled exit reason; optional safe destination; closing note; placement close; absence resolution; balance/document checklist outcomes | append exit; close placement/bed at same effective boundary; retain records |
| active | discharged | owner admin, program director, current assigned-house manager | discharge date; mandatory controlled discharge reason; mandatory note; closing checks | append discharge; close placement/bed; prevent new ordinary operational activity |
| exited | active | owner admin, program director; house manager only when both prior/current scope and new assigned placement are authorized | re-entry date; new approved application or administrative re-entry reason; available bed; duplicate/reapplication review | append reactivation; create a new placement episode; do not reopen old assignment |
| any non-terminal | correction without state change | owner admin, program director | correction reason; target event; corrected projection values; evidence date | append correction referencing prior event; never update/delete prior event |
| discharged | any | none at launch | not permitted | new policy approval required; reapplication remains linked but cannot reactivate |

The only resident-state edges are `pending -> active`, `active -> exited`,
`active -> discharged`, and documented `exited -> active`. A pending relationship that
ends before activation remains pending with its application disposition/history; it does
not invent a resident exit. House managers may exit, discharge, or reactivate assigned
residents, but may only request/recommend activation or correction. They cannot correct
lifecycle history, act outside server-derived scope, place into an unassigned house,
restore/delete records, or make a discharged resident active. Residents cannot change
application or resident lifecycle state.

### Resident-facing access consequences

Lifecycle is re-evaluated server-side for every resident-facing request; a role claim or
previously issued session never proves current operational access.

| Resident state | Launch resident-facing access |
|---|---|
| `pending` | No normal resident portal routes. Only the minimal account/pending-session experience approved by authentication policy. |
| `active` | Normal own-record resident access, still limited by route, category, sharing, and response-shaping policy. |
| `exited` | No resident-facing business-record routes at launch because no historical self-service route set has yet been approved. A later reduced historical scope must be explicitly named per route/resource in policy before exposure. |
| `discharged` | No resident-facing business-record reads or mutations and no new operational activity. |

Exit and discharge revoke the resident account's active sessions in the same transaction
or through a guaranteed co-committed revocation operation, then subsequent login/session
bootstrap and every protected request recheck current resident state. This does not change
the account role, delete credentials, or erase records. Staff historical access continues
under role/house/resource scope. Failures use the agreed uniform unauthorized/not-found
behavior and do not disclose lifecycle details to an inaccessible caller.

### Reason and note rules

- Reason values are controlled codes with optional explanatory notes; notes never replace
  a code.
- `declined`, `withdrawn`, `expired`, `exited`, `discharged`, waitlist removal, transfer,
  absence denial/cancellation, and every correction require a reason.
- Discharge and correction require a non-empty staff note. Exit notes are required when
  the selected reason is `other` or an exception was used.
- Effective dates are calendar dates. Recorded/action times are timezone-aware timestamps.
- Backdating or future-dating beyond an approved operational window requires an
  administrator exception reason; the original recorded timestamp remains unchanged.
- Sensitive narrative must stay in the appropriate scoped note/document record. Lifecycle
  history and generic audit metadata contain only controlled codes and minimal summaries.

## 6. Related lifecycle records

### Placement and transfer

A placement episode links one resident to one service house and, when assigned, one bed.
It has planned/actual start, actual end, status, source application, actor, and reason.

- A resident may have at most one current placement.
- A bed may have at most one current occupancy, subject to explicit family occupancy rules.
- Transfer atomically closes the prior assignment and opens the new assignment on one
  effective date. The prior row is never edited into the new house.
- Bed holds are distinct from occupancy, expire explicitly, and cannot silently exceed
  capacity.
- Current house/bed shown in resident views is a projection of the open assignment.

### Temporary absence

An absence episode records resident, placement, start date/time as appropriate, expected
return date, actual return, controlled reason, approval state, actor, and notes.

- Absence does not change resident state.
- The placement remains open unless policy explicitly releases the bed.
- Return closes the absence; extensions append evidence rather than replacing the
  original expected return without history.
- Overlapping open absences for one resident are prohibited.

### Staff assignment

Resident-to-staff assignments are dated operational relationships with role/purpose,
assigned-by actor, start/end dates, and reason. They do not grant broader access than the
authenticated account's house/role scope. Ending a staff assignment preserves history.

### Milestones

Milestones are typed operational records with target date, completion date, status,
visibility/category, assigned staff, source, and optional notes. They may inform work
queues but cannot automatically change lifecycle state, payment status, document approval,
or clinical decisions.

### Alumni follow-up

Alumni follow-up applies to `exited` residents only and is not a fifth resident state.
Store explicit contact consent/preferences, next follow-up date, outcome code, completed
date, actor, and minimal notes. `discharged` residents receive no alumni follow-up unless a
later approved policy explicitly permits it.

### Reapplication

A returning person receives a new application linked to the existing resident/person and
the prior application when known. Successful re-entry transitions the existing `exited`
resident to `active` and creates a new placement episode. It must not create a second
resident merely because contact details changed.

## 7. Duplicate detection and identity resolution

Duplicate detection is a review control, not an automatic identity merge.

1. Normalize email (trim and case-fold), phone (validated canonical digits/country code),
   and names (trim/collapse whitespace; retain original display name).
2. A normalized email exact match is a blocking candidate across residents and open/recent
   applications.
3. Name plus normalized phone is a blocking candidate.
4. Name plus date of birth or another approved non-sensitive identity field may become a
   candidate only after that field has an approved storage/access policy. Do not place
   sensitive intake narrative in a match key.
5. Create/import/convert/reapply must run the same candidate search and repeat it inside
   the write transaction. A preview-only check is insufficient.
6. Staff choose: link to existing person/resident, confirm distinct person with mandatory
   reason, or stop for administrator review. No automatic merge or destructive dedupe.
7. Concurrent writes require normalized-key uniqueness or a transaction/advisory lock.
   The current non-unique resident email index is not enough.
8. Identity corrections append merge/link/correction history; dependent payment,
   document, assessment, and audit records are never silently reassigned.

## 8. Safe persistence plan

Names below describe responsibilities, not a requirement to use a particular SQL name.

### Additive entities and columns

| Persistence area | Minimum contents and constraints |
|---|---|
| Application projection | checked application stage; assigned reviewer where applicable; disposition/effective dates; optional prior application and existing resident link |
| Application history | application, from/to stage, reason code, note reference/minimal note, effective date, actor, recorded timestamp, correlation ID; append-only |
| Waitlist entry/history | application, queue entry date, priority value and approved source, requested/effective/expiry dates, current/closed status; append-only reprioritization, extension, removal, and correction events with reason, actor, timestamp, and correlation ID |
| Interview appointment/outcome | application, scheduled start, interviewer, status (`scheduled`, `rescheduled`, `cancelled`, `no_show`, `completed`), outcome/reason, actor, timestamp, correlation ID; retain every attempt and link a reschedule to the prior appointment |
| Resident lifecycle history | resident, from/to state, event kind, reason, effective date, actor, correction-of event, recorded timestamp, correlation ID; append-only |
| Rooms and beds | stable house FK, labels, occupancy type/capacity, active/availability state; uniqueness within house/room |
| Placement/bed assignment | resident, house, room/bed, source application, start/end, status/reason, actor; one current resident placement and no conflicting bed occupancy |
| Absence episode | resident/placement, start, expected/actual return, reason, approval/status, actor; no overlapping open episodes |
| Staff assignment | resident, account/staff reference, purpose, start/end, assigned-by/reason; dated history |
| Milestone | resident, type, target/completed dates, status, visibility/category, assignee/source; checked domains |
| Alumni follow-up | exited resident, consent/preferences, due/completed dates, outcome, actor; no implicit contact authorization |
| Identity/link review | normalized candidate keys or hashes as approved, decision, reason, actor, links between application/resident records; no sensitive narratives |

Keep `audit_events` polymorphic so evidence can outlive a source record. Domain history is
the lifecycle source of truth; generic audit is the security/operational evidence index.
Both must be written in the same transaction as each transition.

Waitlist reprioritization, extension, and removal and interview reschedule, cancellation,
no-show, completion, and repeat attempts are typed domain events even when the
application's projected stage does not change. They append evidence and update only the
current queue/appointment projection; they never replace the prior priority or appointment.

### Backfill and reconciliation

1. Run count-only preflight in the target environment: status values, duplicate/normalized
   identities, application conversion links, ambiguous house names, unmatched resident
   homes, multiple active-like records, invalid dates, and orphan relationships.
2. Add nullable columns/tables/check-compatible values and indexes first. Do not guess
   house, bed, application, exit reason, or historical dates.
3. Map resident `home` to a house only when exactly one reviewed active/inactive house
   match exists. Put ambiguous/unmatched rows in a reconciliation queue.
4. Create one explicitly labeled `legacy_baseline` lifecycle event per resident using the
   known current status and earliest reliable recorded date. Do not fabricate transitions.
5. Map current `active|pending|exited` status directly. `discharged` has no current rows
   unless production evidence proves otherwise. Reconcile arbitrary `lifecycleState`
   separately; never let it override a valid reviewed status automatically.
6. For active residents with a uniquely matched house, create a legacy current placement
   with unknown bed. Do not infer individual bed occupancy from house capacity.
7. Preserve application conversion links. Do not automatically link unconverted
   applications to residents based only on fuzzy matches.
8. Reconcile direct/import duplicates through reviewed link/distinct decisions. Do not
   delete records during lifecycle rollout.
9. Validate coverage and dual-read parity before adding NOT NULL, unique-current,
   exclusion, or checked-state constraints in later migrations.
10. Use bounded resumable backfill batches with retained counts and failure details.

### Compatibility constraints

- Continue returning legacy resident `status`, `home`, and `moveInDate` during a migration
  window, but derive them from canonical records after backfill.
- Dual-write only through one service transaction; do not add independent route-level
  writes that can partially succeed.
- Existing reports must state whether they use legacy or canonical occupancy during each
  stage. Never combine both and double-count.
- Existing payment/document/assessment foreign keys remain attached to the resident.
  Reapplication does not move them to a new resident.
- Application documents remain application-owned unless an explicit reviewed conversion
  rule creates a resident-facing association; do not bulk rewrite ownership.
- Fresh databases must run the full checked-in migration chain. Legacy baselining rules
  remain those in the existing database reliability guidance.

## 9. API and contract inventory

Add the application paths to OpenAPI before building generated-client UI. Recommended
server operations:

- application create/detail/list;
- application stage transition and correction;
- interview schedule/outcome;
- waitlist placement/removal;
- application conversion/initial placement;
- resident lifecycle transition and correction;
- placement hold/assign/transfer/close;
- absence start/extend/return/cancel;
- staff assignment start/end;
- milestone create/update/complete;
- alumni follow-up list/create/complete;
- reapplication creation linked to an existing resident; and
- lifecycle timeline reads shaped by role and house scope.

Every mutation request uses strict allowlists, a current-version or expected-state guard,
an idempotency key for retryable conversion/placement transitions, and a required
effective date/reason where specified. Responses expose role-shaped projections; they do
not return staff-private notes to residents.

The generic resident update contract remains for safe demographic/contact fields only.
Application PATCH remains for safe draft/intake fields only. Neither accepts state,
conversion, placement, assignment, absence, exit/discharge, or correction fields.

## 10. Page and component inventory

| Surface | Required product change |
|---|---|
| Operations / Applications | Stage filters/counts, duplicate flags, assignee, next action, waitlist/interview indicators; no status editing inline |
| Application detail | Intake summary, checklist, documents, stage timeline, review/interview/waitlist actions, duplicate resolution, approve/decline/withdraw, conversion |
| Placement workspace | House/room/bed availability, holds, eligibility/capacity explanation, effective date, conversion confirmation |
| Resident directory | Canonical status and current placement filters; distinguish absence from exit; alumni view for exited residents |
| Resident detail | Lifecycle timeline plus profile, current/prior placements, absences, staff assignments, milestones, source application, documents/assessments/payments links |
| Exit/discharge dialog | Controlled reason, effective date, required note, placement close, unresolved checklist outcomes, clear consequences |
| Transfer dialog | Current and target assignment, capacity checks, effective date, reason, atomic confirmation |
| Absence workflow | Start, expected return, extension, return, overdue indicator without changing resident state |
| Alumni workspace | Opted-in exited residents, next contact, outcome, history, reapply action |
| Import review | Canonical allowed states, shared duplicate rules, house reconciliation, per-row baseline evidence |
| Dashboard/reports | Occupancy from assignments; application funnel/waitlist; admissions/exits/discharges/transfers; alumni follow-up definitions |

Shared components should include a state badge vocabulary, transition action menu,
reason/effective-date form, immutable timeline, duplicate-candidate review, placement
selector, closing checklist summary, and role-aware empty/restricted states.

## 11. Staged delivery boundaries and acceptance criteria

### Stage A — Lifecycle data foundation

**Boundary:** additive schema, canonical domains, history, stable relationships, preflight,
backfill/reconciliation tooling; no browser behavior switch.

**Acceptance criteria**

- application and resident projections have checked canonical values;
- append-only application/resident history can represent every matrix transition,
  correction, actor, reason, effective date, and correlation ID;
- placements, beds, absences, staff assignments, milestones, alumni follow-up, and
  reapplication links have explicit constraints;
- waitlist entries retain every priority/expiry change and interview records retain every
  appointment, reschedule, cancellation, no-show, completion, and repeated attempt;
- migration is nullable/additive first and passes fresh-database and dirty-legacy fixtures;
- preflight reports ambiguity without deleting, guessing, or silently fixing data;
- baseline events are clearly marked and never claim unknown historical transitions;
- existing reads remain compatible while canonical and legacy projections are compared.

### Stage B — Intake and placement

**Boundary:** OpenAPI application pipeline, duplicate review, interview/waitlist,
conversion, and initial placement; documents/payments remain separate.

**Acceptance criteria**

- every application stage change follows the matrix and appends history/audit atomically;
- house managers cannot read or transition out-of-scope applications;
- conversion is idempotent, blocks unresolved duplicates, links exactly one resident, and
  creates no partial resident/placement/application state;
- application stage transitions are administrator-only; house managers can create/edit
  scoped intake facts and submit a recommendation but cannot change stage;
- capacity and bed eligibility are server-derived and concurrent placement cannot
  double-occupy a bed;
- terminal applications cannot be edited back into an active stage except by correction;
- application routes exist in OpenAPI and generated clients before UI use;
- ignored browser fields are removed or represented by a real server contract.

### Stage C — Resident record workspace

**Boundary:** timeline, transfers, absences, staff assignments, milestones, exit/discharge,
alumni follow-up, and reapplication; no clinical protocol invention.

**Acceptance criteria**

- generic resident PATCH cannot alter protected lifecycle or placement facts;
- activation, exit, discharge, reactivation, transfer, and corrections enforce actor,
  scope, current state, reason/note/date, and exceptional-path rules;
- activation and correction are owner-admin/program-director actions; house managers may
  only request/recommend them, while assigned-resident exit/discharge/reactivation remains
  available under server-derived scope;
- pending residents have no normal portal access; exit/discharge immediately revoke active
  resident sessions and all later resident-facing requests recheck current lifecycle state;
- exited residents have no business-record portal scope at launch until a route-by-route
  historical scope is separately approved; discharged residents have no such access;
- transfer closes/opens assignments atomically and retains prior history;
- absence never silently changes resident state or occupancy;
- exit/discharge closes current placement and prevents inappropriate new operations;
- discharged remains terminal; exited re-entry uses a linked reapplication/new placement;
- timeline and responses are role-shaped and omit staff-private or unrelated sensitive data;
- alumni contact occurs only with recorded consent/preferences.

### Stage D — Release validation

**Boundary:** contract, migration, authorization, concurrency, report, and critical browser
evidence for the completed lifecycle rollout.

**Acceptance criteria**

- transition table tests cover every allowed and denied edge, including stale expected
  state, backdating exceptions, terminal states, and corrections;
- typed same-stage event tests prove waitlist reprioritization/extension/removal and
  interview reschedule/cancellation/no-show/repeat attempts append history rather than
  overwriting earlier evidence;
- authorization tests cover owner/program/manager/resident, cross-house IDs, source and
  target scope, and uniform inaccessible-resource behavior;
- post-transition authorization and browser tests prove pending residents cannot enter the
  normal portal, exit/discharge invalidates active sessions immediately, exited/discharged
  residents cannot read or mutate resident-facing business records, and staff retain only
  their permitted historical scope;
- concurrency tests prove one conversion, one current placement, and no bed collision;
- migration tests cover fresh chain, valid legacy baseline, ambiguous houses, duplicates,
  invalid state text, resumability, and rollback/recovery evidence;
- report tests prove occupancy derives from assignments and define exited/discharged/
  absence/alumni inclusion explicitly;
- integration tests prove business change, domain history, and audit evidence commit or
  fail together;
- browser coverage exercises application review-to-placement, transfer, absence/return,
  exit, and exited reapplication without exposing direct status/home edits;
- payment, document, assessment, import, dashboard, report, account/session, retention,
  and access-control regression suites remain green at their agreed boundaries.

## 12. Test impact inventory

At minimum, update or add focused coverage for:

- API authorization and access-policy tests;
- application route reliability and strict-body tests;
- resident create/update and import integrity tests;
- database migration/catalog and fresh-database checks;
- dashboard occupancy and overview metrics;
- reports and exports;
- document ownership/sharing through conversion;
- assessment visibility after exit/discharge/reactivation;
- payment ownership and closing-balance review without payment mutation;
- account/session behavior when resident operational access changes;
- retention/quarantine separation from exited/discharged state; and
- the web critical workflow for intake, placement, transfer, exit, and reapplication.

Existing browser document-history coverage should also use the ID returned by document
creation rather than an unrelated response property when that suite is next modified.

## 13. Release invariants

Implementation is not complete unless all of these remain true:

1. one resident/person history survives reapplication and re-entry;
2. no lifecycle transition is performed by generic field editing;
3. no transition or transfer loses its prior event;
4. current state, current placement, and bed occupancy cannot contradict within a committed
   transaction;
5. payments, documents, assessments, and meetings may inform workflow but never
   independently change lifecycle state;
6. exited/discharged is not deletion, and deletion/quarantine is not a lifecycle state;
7. house and resident scope come from the authenticated principal and persisted
   relationships, never a client claim;
8. audit metadata remains minimal and excludes sensitive narrative;
9. unknown legacy facts remain unknown and reviewable rather than guessed; and
10. application and resident state machines are represented in the API contract, enforced
    by the server, constrained by the database, and rendered consistently by the UI.