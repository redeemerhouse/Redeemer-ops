---
name: Workspace TypeScript builds
description: Composite package declaration freshness can affect downstream workspace typechecks.
---

Referenced composite packages may retain stale declaration output after source export changes, causing downstream checks to report missing exports that are present in source.

**Why:** Workspace package resolution can use the package's source entry while the project-reference graph still has outdated declaration state.

**How to apply:** When a downstream typecheck disagrees with current workspace exports, force-rebuild the referenced package/project before changing application code.