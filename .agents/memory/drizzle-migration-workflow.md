---
name: Drizzle migration output
description: Workspace-specific constraint for generating and checking Drizzle migrations.
---

The installed Drizzle CLI expects the migration output directory to be configured relative to the database package; absolute output paths can be rewritten with an extra `./` prefix and make snapshot checks fail. Snapshot files are selected by the journal entry's zero-padded numeric index, not its descriptive migration tag. PostgreSQL catalog expressions require semantic normalization, but logical grouping must remain intact.

**Why:** The CLI resolves its configured output relative to the package command directory, and its handling of an absolute path is not reliable in this workspace. PostgreSQL also rewrites equivalent defaults and checks with casts, `ANY(ARRAY[])`, and extra parentheses; stripping all parentheses can hide precedence-changing drift.

**How to apply:** Keep the Drizzle output package-relative, pair journal entries to snapshots by numeric index, normalize catalog formatting narrowly while preserving boolean grouping, run the migration-chain check after generation, and verify application against a clean temporary database before release.