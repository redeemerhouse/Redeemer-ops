---
name: Playwright on Replit Nix
description: Environment requirements for running Playwright Chromium in this Replit workspace.
---

Playwright's JavaScript package alone is insufficient in this Nix environment. A working browser run requires the matching Playwright Chromium download plus explicit Nix packages for Chromium's shared libraries, including `libgbm`.

**Why:** Chromium installation succeeded but browser launch still failed first for the general Linux library set and then specifically for `libgbm`; these failures occur before any test logic executes.

**How to apply:** When Playwright is installed or upgraded, install its matching Chromium build and preserve the workspace's Nix browser-runtime dependencies before diagnosing browser-test code.