---
name: Replit production database TLS
description: The node-postgres SSL policy required for Replit-managed PostgreSQL in production autoscale deployments.
---

Production node-postgres clients must use `ssl: { rejectUnauthorized: true }` and rely on the runtime's trusted CA store. `DB_SSL=true` is mandatory; a URL containing only `sslmode=require` is not accepted as a verification substitute.

**Why:** Encryption without peer verification permits database endpoint impersonation and exposes resident, payment, and session data. A security review rejected the prior compatibility workaround that disabled certificate verification.

**How to apply:** Keep the policy consistent across runtime, integrity preflight, release checks, baselining, and post-merge tooling. Verify the exact production startup and health path before release; if the managed chain is not trusted, configure a trusted CA rather than disabling verification.

For disposable sibling databases, PostgreSQL CLI maintenance commands need `sslmode=verify-full&sslrootcert=system`. Node PostgreSQL clients use `sslmode=verify-full` with the runtime trust store and should not receive the CLI-only `sslrootcert=system` parameter.