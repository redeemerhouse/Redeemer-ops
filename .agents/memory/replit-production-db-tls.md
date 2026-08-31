---
name: Replit production database TLS
description: The node-postgres SSL policy required for Replit-managed PostgreSQL in production autoscale deployments.
---

When production database SSL is enabled for node-postgres, use `ssl: { rejectUnauthorized: false }` for the Replit-managed production connection.

**Why:** Replit's managed production PostgreSQL endpoint requires SSL but uses a certificate setup that is incompatible with full certificate-chain verification in node-postgres. Requiring `rejectUnauthorized: true` prevents the API from connecting during startup, so the process exits before opening its deployment port.

**How to apply:** Keep the production-only SSL guard and encrypted connection, but do not tighten node-postgres certificate verification unless Replit's connection guidance or managed certificate chain changes. Verify changes with the exact production startup command and health endpoint.