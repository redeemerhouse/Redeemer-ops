---
name: Account session boundary
description: Security boundary for browser accounts, service bearer principals, and administrator assignment changes.
---

Production browser accounts authenticate through revocable PostgreSQL sessions; unsigned client claims and standalone bearer principals must not grant production user access. Administrator role or house reassignment revokes existing sessions so the next sign-in receives a freshly derived principal. The first owner is provisioned only through a dedicated managed setup secret and an atomic empty-account check; ordinary registration never grants administrative access.

**Why:** Signed claims alone remain valid after logout, password reset, deactivation, or administrator reassignment. Requiring a live session record makes those controls immediate and prevents stale scope from authorizing access. Automatic “first registrant wins” promotion would let a public visitor seize organization ownership.

**How to apply:** New browser authentication and authorization flows must use the secure session cookie and load current account scope server-side. Keep any sid-less bearer compatibility limited to non-production test environments. Keep first-owner setup one-time, fail-closed, and separate from the session-signing secret.