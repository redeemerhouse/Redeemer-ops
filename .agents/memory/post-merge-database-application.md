---
name: Post-merge database application
description: How to verify schema-bearing task merges actually update the development database before workflows restart.
---

Use an exact workspace package filter and a real noninteractive development-schema command in post-merge setup. Treat a zero exit code as insufficient unless the output shows Drizzle inspected and applied the schema.

**Why:** pnpm can report that none of the selected packages has a requested script and still let the setup appear successful. That leaves the development database behind and can make API startup fail as soon as seed or route code touches a newly added table.

**How to apply:** After schema-bearing merges, confirm post-merge output includes the intended Drizzle command and a successful schema application. Development may use the supported push flow; production schema changes remain owned by Replit's interactive Publish diff.