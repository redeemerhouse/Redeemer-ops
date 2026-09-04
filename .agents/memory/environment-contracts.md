---
name: Environment data contracts
description: Runtime, database, provider, and synthetic-fixture boundaries for safe release work.
---

All API, seed, migration, automated-test, and recovery processes must declare their runtime
identity, database target, payment mode, storage mode, and email mode. Disposable database work
also requires an explicit confirmation and a visibly disposable target identity; production
promotion must reject sandbox/test provider settings.

**Why:** A shared development or client database can look superficially valid to a script, and
provider credentials or synthetic fixtures can cross that boundary before a route or test fails.

**How to apply:** Preserve the fail-closed environment contract when adding scripts, adapters, or
release checks. Keep test/recovery targets dedicated and redacted, and treat skipped recovery
evidence as no release evidence until a dedicated non-client target is supplied.