---
name: Drizzle migration output
description: Durable safety rule for generating and verifying Drizzle migrations.
---

Generate migrations through the database package's configured workflow, and treat generated metadata plus catalog comparisons as one integrity boundary rather than editing either side independently.

**Why:** Tooling may rewrite equivalent database expressions or resolve migration metadata differently from hand-edited assumptions. Over-normalizing those differences can hide real precedence or schema drift.

**How to apply:** Use the package-owned generation command, avoid hand-editing generated metadata, normalize catalog formatting narrowly while preserving boolean grouping, run the migration-chain check, and verify application against a clean temporary database before release.