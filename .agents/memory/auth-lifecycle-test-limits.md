---
name: Authentication lifecycle test limits
description: How concentrated authentication lifecycle verification should coexist with layered abuse controls.
---

Authentication lifecycle suites that intentionally perform many registration, login, and administrator mutations must keep the general route limiter distinct from the credential-specific login limiter. A disposable harness may raise its general mutation ceiling, but it must retain and exercise the production credential-attempt limit.

**Why:** A concentrated end-to-end lifecycle can exhaust the global mutation bucket before reaching suspended or disabled login assertions, producing a valid 429 that masks the account-status behavior under test.

**How to apply:** Use a disposable database and test-only server configuration for broad lifecycle coverage. Raise only the harness-wide mutation allowance when needed; do not weaken login-specific attempt controls or production defaults.