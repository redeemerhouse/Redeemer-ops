# Security release readiness

**Status: NO-GO until the gate passes**

Run `pnpm run security:release-gate` to enumerate the current API contract, mounted server handlers, generated client surface, and browser API calls. The command intentionally fails when a sensitive route lacks server-side controls; OpenAPI metadata, generated Zod/client code, and UI behavior are never accepted as enforcement.

## Protected operation inventory

The release gate reviews:

- Dashboard and activity aggregates.
- Resident list, create, detail, and update operations.
- Payment list and create operations.
- Application list, create, and update operations.
- Document list and create operations, including object-path and visibility fields.
- Operations list and create operations.
- Report summaries and administrator-only CSV/PDF exports.

The public health check is the only operation that may be public. Any new route must be added to the OpenAPI contract, generated artifacts, browser-call inventory, and this gate's server-enforcement checks before release review.

## Required controls

For each protected operation, the gate requires evidence of:

1. Authenticated principal and centralized role/action authorization.
2. Server-derived organization/house/resource scope on every read, write, relationship lookup, and aggregate.
3. Strict params/query/body validation and response DTO validation.
4. Allowlisted mutations and server-authoritative status, ownership, balance, names, and derived dates.
5. Safe, uniform errors with no stack, SQL, PII, payment values, or credential material.
6. Explicit CORS, parser limits, security headers, rate limits, and sensitive-log redaction.
7. Contract regeneration with no generated-artifact diff.
8. Database constraints aligned with API enums, nullability, date, money, and relationship invariants.

## Targeted abuse-case coverage

The release gate is not a substitute for route tests. Before a GO decision, route-level tests must demonstrate:

- IDOR and horizontal scope escalation are rejected for resident, payment, document, application, and operation IDs.
- Vertical privilege escalation is rejected for staff-only changes, administrator exports, audit history, and document visibility.
- Unknown/mass-assignment fields cannot mutate role, scope, status, balance, ownership, audit actor, or object paths.
- Invalid money (negative, non-finite, over-precision) and dates are rejected consistently.
- Dashboard, activity, report, and list aggregates cannot cross organization/house scope.
- Export and document access enforce approval, role, scope, and content-disposition rules.
- Collection limits, body limits, CORS, rate limiting, security headers, and safe error mapping are asserted.
- Logs and browser error handling redact request bodies, PII, money, tokens, SQL, and stack traces.

## Retention verification

Deletion retention is kept behind a server-only service boundary until the
authentication and authorization work is complete. The current boundary:

- stores an immutable target/scope/reason/actor snapshot in a 15-day quarantine;
- writes the quarantine audit event before the source-move callback runs;
- exposes quarantine metadata only to an authenticated `owner_admin` or
  `program_director`, never the archived record itself;
- requires an audited cancellation reason and an explicit restore callback; and
- re-checks active legal holds inside the purge transaction, records a blocked
  purge, claims due rows to prevent concurrent workers, and empties the archive
  only after durable purge evidence is written.

The current implementation does **not** yet enforce the approved role split. Its shared
administrator assertion admits a `program_director` to cancellation/restore, and the
purge worker treats elapsed quarantine time as sufficient to purge without verifying a
recorded owner-admin permanent-deletion approval. These are explicit release blockers,
not accepted behavior.

Run `pnpm --filter @workspace/api-server run test:retention` only to verify the current
15-day mechanics, organization scope, reason validation, restore state transitions, and
legal-hold pause policy. A passing result does not verify the approved authority model.
Before a GO decision, direct tests must prove that a program director may request or move
a record into quarantine but cannot restore, cancel, approve permanent deletion, or cause
a purge; they must also prove that the purge worker requires recorded owner-admin approval
after eligibility. This does not make any route safe by itself; the future authenticated
route must pass a principal object into the service rather than trusting request headers.

## Current release decision

The current repository is **NO-GO**. The API mounts sensitive handlers that directly access PostgreSQL and accept raw request bodies; authentication, centralized authorization, tenant/house scoping, complete validation, response shaping, safe error middleware, explicit CORS, parser limits, rate limiting, and security headers are not yet established consistently. Report exports additionally use a client-controlled role header and unscoped aggregate queries.

These are explicit blockers, not accepted risks. The tenancy, role, lifecycle, money,
retention, deletion, and access-policy decisions are approved in
`SECURITY_OPERATING_MODEL.md`; they are no longer unresolved prerequisites. Release
remains blocked until the implementation and tests enforce those decisions—including the
retention authority split above—and the gate plus route-level tests report GO.