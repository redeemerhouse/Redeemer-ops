---
name: Dependency source integrity
description: Supply-chain requirement for dependencies unavailable as patched releases under their original npm package name.
---

Use an npm-registry package or alias whose lockfile entry includes a content-integrity digest; do not depend directly on a remote tarball URL for production code.

**Why:** A frozen lockfile that records only a URL does not prove the downloaded archive bytes are unchanged, so replacing a vulnerable package that way trades a known advisory for a supply-chain risk.

**How to apply:** When the original package has no patched registry release, choose a maintained registry-hosted replacement or compatible registry alias, verify the lockfile has an integrity digest, and run both the audit and a focused behavior test.