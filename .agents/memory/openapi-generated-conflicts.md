---
name: OpenAPI merge resolution
description: How to safely resolve conflicts spanning the API specification and generated Orval artifacts.
---

Treat the OpenAPI specification as the source of truth when a rebase conflicts in generated API clients or validators. Resolve the source contract additively, then regenerate all dependent artifacts and run codegen consistency checks.

**Why:** Hand-merging generated files can leave client, Zod, and server validation shapes subtly out of sync even when conflict markers are gone.

**How to apply:** Preserve compatible incoming and task fields in the source schema, regenerate with the workspace codegen command, and validate the API route and consumers after staging the regenerated output.