---
name: Baseline recovery evidence
description: Durable evidence requirements for adopting a legacy database into migration history.
---

A legacy migration baseline requires a credential-free evidence manifest for a
backup retained in an approved encrypted destination. The evidence must bind the
exact target and migration boundary to the backup checksum, successful restore
drill, and retention date; verbal confirmation is not sufficient.

**Why:** A temporary backup and one maintenance-session restore can protect the
immediate change but leave no durable recovery or audit proof after the session
ends.

**How to apply:** Keep backup contents, paths, credentials, URLs, and resident
data out of Git and command logs. Validate the retained artifact checksum before
restoring it into an isolated database, and retain the credential-free manifest
beside the encrypted artifact.