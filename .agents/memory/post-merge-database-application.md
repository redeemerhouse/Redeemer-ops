---
name: Post-merge database application
description: How to verify schema-bearing task merges actually update the development database before workflows restart.
---

Use an exact workspace package filter and a real noninteractive development-schema command in post-merge setup. For a legacy development database with an empty ledger, setup may skip migration only when a catalog comparison proves an exact match with the latest checked-in snapshot.

**Why:** pnpm can report that none of the selected packages has a requested script and still let setup appear successful, while blindly migrating an already-current untracked schema attempts to recreate tables. Exact-snapshot gating avoids both failures without pretending migration history exists.

**How to apply:** After schema-bearing merges, require either a successful Drizzle migration or an exact latest-snapshot catalog match. Any drift must fail setup. Replit Publish owns production schema application; production API startup must not run migrations or DDL. Never use push, forced migration, or synthetic ledger rows as a fallback.