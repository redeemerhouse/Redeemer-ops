---
name: Liveness and readiness boundaries
description: Operational probe semantics and shared-protection readiness rules for production services.
---

Process liveness must remain outside authentication, sessions, and dependency-backed request
protection. Dependency readiness may bypass the shared limiter, but its checks must be
single-flight and briefly cached so public probe bursts cannot amplify database or logging
failures.

**Why:** Coupling liveness to a failed PostgreSQL limiter caused a healthy Node process to enter a
restart loop. A readiness check can also create false-ready results when it checks only table
existence or partial privileges, and can become its own outage amplifier if every request reaches
the dependency.

**How to apply:** Keep liveness limited to serving HTTP. Readiness should report only safe
dependency states, categorize failures without raw provider details, and verify every database
privilege exercised by normal protected traffic, including cleanup paths. Preserve fail-closed
behavior for authentication and business routes.