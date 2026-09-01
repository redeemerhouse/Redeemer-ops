---
name: Orval dependency patching
description: Why security-only dependency maintenance keeps the current Orval generator exact.
---

Keep the established Orval release exact during security-only transitive dependency updates; patch compatible vulnerable descendants with workspace overrides instead of widening the generator version.

**Why:** A range refresh selected a newer Orval release whose generated fetch header code required `Headers.entries()`, which is not available under this workspace's current TypeScript library contract and caused generated-client typecheck failures.

**How to apply:** When an advisory affects Orval descendants such as YAML, URI, glob, or build packages, first use narrow patched-version overrides and run codegen plus library typechecks. Upgrade Orval separately only when generated output changes are in scope.