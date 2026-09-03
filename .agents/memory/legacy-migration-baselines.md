---
name: Legacy migration baselines
description: Safety boundary for adopting schema-push databases into checked-in Drizzle history.
---

A legacy database may be baselined only when its live catalog is exactly
equivalent to the designated migration, its credential-free connection identity
is explicitly confirmed, and backup plus tested recovery are confirmed. A
release may trust an existing ledger only when its rows are an exact hash and
timestamp prefix of the checked-in migration chain. Fresh databases must never
be baselined; they apply the full checked-in chain normally. An existing empty
ledger is adoptable only when its namespace, table, index, sequence, ownership,
and access controls are canonical; a bare or noncanonical migration namespace
must be refused. Exact catalog comparison includes constraint validation and
deferrability state, namespace ACLs, and migration-role default privileges.

**Why:** A ledger row is an assertion that every table, constraint, default, and
sequence semantic from that migration already exists. Permissive checks can
hide divergent defaults or sequences and let later releases operate on a schema
that migration history never produced.

**How to apply:** Keep baseline verification fail-closed and ledger-only. Bind
operator confirmation to the actual database identity, compare catalog objects
and default/sequence semantics exactly, reject malformed or divergent ledgers,
reject noncanonical empty migration namespaces and privilege defaults, and
preserve the ordinary migration path for empty databases.