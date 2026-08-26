---
name: OpenAPI export parameter generation
description: Orval's Zod generator can collide when a path-and-query operation shares its operation-name params type.
---

When adding an OpenAPI operation with both path and query parameters, check generated Zod exports for a params-name collision before relying on the workspace typecheck.

**Why:** The generator can emit the path parameter schema and query parameter type under the same exported name, even though the React client output remains valid.

**How to apply:** Run API code generation and library typechecking together; resolve the generated export collision without changing the runtime endpoint contract. If the Zod package only consumes runtime schemas, disable its generated barrel (`indexFiles: false`) rather than renaming the operation.