---
name: Account session boundary
description: Security boundary for browser accounts, service bearer principals, and administrator assignment changes.
---

Production browser accounts authenticate through revocable PostgreSQL sessions; unsigned client claims and standalone bearer principals must not grant production user access. Administrator role or house reassignment revokes existing sessions so the next sign-in receives a freshly derived principal.

**Why:** Signed claims alone remain valid after logout, password reset, deactivation, or administrator reassignment. Requiring a live session record makes those controls immediate and prevents stale scope from authorizing access.

**How to apply:** New browser authentication and authorization flows must use the secure session cookie and load current account scope server-side. Keep any sid-less bearer compatibility limited to non-production test environments.