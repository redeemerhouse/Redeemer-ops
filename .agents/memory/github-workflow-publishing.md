---
name: GitHub workflow publishing
description: Constraint on publishing GitHub Actions workflow files through the standard GitHub connector.
---

The standard GitHub connector authorization may include repository write access while omitting
GitHub's separate workflow scope. In that state, ordinary repository API reads and writes work,
but commits that create or update files under `.github/workflows/` are rejected.

**Why:** GitHub treats workflow-file modification as a separately privileged operation, and the
connector's available OAuth scope set may not offer that permission even after reauthorization.

**How to apply:** Before attempting to publish a repository containing Actions workflows through
the connector, inspect its effective scopes. If workflow permission is unavailable, use an
authenticated native Git push or another authorization that explicitly permits workflow changes.