---
name: Drizzle migration output
description: Workspace-specific constraint for generating and checking Drizzle migrations.
---

The installed Drizzle CLI expects the migration output directory to be configured relative to the database package; absolute output paths can be rewritten with an extra `./` prefix and make snapshot checks fail.

**Why:** The CLI resolves its configured output relative to the package command directory, and its handling of an absolute path is not reliable in this workspace.

**How to apply:** Keep the Drizzle output configured as a package-relative directory, run the migration-chain check after generation, and verify application against a clean temporary database before release.