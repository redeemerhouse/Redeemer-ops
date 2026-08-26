---
name: Node strip-types test runner
description: Node's built-in TypeScript stripping supports type syntax but not every TypeScript runtime feature.
---

Node's `--experimental-strip-types` test runner does not support constructor parameter properties and does not resolve extensionless workspace directory imports reliably.

**Why:** Focused TypeScript tests can fail before executing when they import workspace packages or use unsupported syntax, even though the project TypeScript compiler and bundler succeed.

**How to apply:** Keep directly tested policy modules runtime-independent where possible, use explicit `.ts` imports in tests, and avoid parameter properties in code exercised by Node's built-in test runner.