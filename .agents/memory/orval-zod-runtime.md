---
name: Orval and Zod compatibility
description: Compatibility constraint between generated API validators and the workspace Zod runtime.
---

Generated API validators are compiled against the workspace’s installed Zod major version, not only the syntax emitted by the current Orval version. Generator options that emit newer helpers can make codegen pass but break the library typecheck.

**Why:** Orval can emit newer Zod helpers such as `zod.int()` or `zod.iso.date()` while this workspace may still resolve an older Zod runtime for generated code.

**How to apply:** After changing OpenAPI numeric/date formats or Orval options, run codegen and the composite library typecheck together. Prefer contract-compatible constraints and explicit server checks over silently upgrading the shared validation runtime.

Orval can also rewrite generated files with trailing blank-line differences that are
not semantic contract changes.

**Why:** The generator output in this workspace has changed whitespace at EOF across
versions, which can make a release check fail after a clean regeneration.

**How to apply:** Normalize generated file endings in the codegen command and make
the generated-diff check ignore whitespace-only EOF changes while still failing on
substantive generated contract changes.