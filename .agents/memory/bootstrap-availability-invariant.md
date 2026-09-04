---
name: Bootstrap availability invariant
description: Keeps first-owner setup status consistent with whether provisioning can actually accept the configured secret.
---

The public first-owner setup status must apply the same configuration-usability rule as the provisioning endpoint.

**Why:** Advertising setup as available with a secret that provisioning will always reject can lock operators out of a brand-new installation.

**How to apply:** When setup-secret requirements change, update both status and token verification through one shared predicate and retain isolated empty-database coverage.