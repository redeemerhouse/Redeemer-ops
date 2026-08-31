---
name: Assessment lifecycle test isolation
description: Durable guidance for testing versioned assessment APIs in the shared development environment.
---

Assessment lifecycle tests should select an active template at runtime, calculate expectations from the highest existing version, and avoid retiring the only active seeded revision. Repeated API-suite runs can also hit the shared in-memory rate limiter.

**Why:** The development database persists between runs, and version publishing intentionally changes template status and history. Fixed seed-version assertions and repeated requests make otherwise-correct tests fail on reruns.

**How to apply:** Keep lifecycle fixtures history-aware, leave a usable active revision after exercising retirement, and restart or otherwise isolate the API when rerunning high-volume authenticated integration tests.