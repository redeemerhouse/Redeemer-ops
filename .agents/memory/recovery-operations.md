---
name: Recovery operations data boundaries
description: Durable architectural boundaries for the recovery housing MVP.
---

Core resident, payment, house, application, document metadata, daily-operation, and audit records belong in PostgreSQL. Authentication, binary file bytes, and finalized CSV/PDF export delivery should remain explicit boundaries rather than hidden fallbacks.

**Why:** Sensitive housing operations need durable history and clear ownership of access, while auth and file/export infrastructure require organizational approval and provider configuration.

**How to apply:** Extend the current domain APIs with server-side authorization and an approved storage/auth provider; do not move file bytes into database JSON or silently treat an unauthenticated browser as staff.