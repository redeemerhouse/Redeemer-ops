# Legacy database baseline procedure

This is a one-time procedure for a database that was initialized by the retired
schema-push workflow and exactly matches a designated checked-in migration
snapshot but has no Drizzle migration history. It is not a general schema
repair tool.

## Before running it

An operator must:

1. Select the target explicitly as the credential-free
   `host:port/database-name` identity from `DATABASE_URL`. The command compares
   that exact identity with the URL and confirms the connected database name.
2. Take, or confirm the existence of, a restorable backup for that exact
   database.
3. Confirm that the tested recovery/PITR procedure can recover that database.
4. Select the exact checked-in migration tag whose snapshot is expected to
   match the live catalog. Do not choose a later tag merely to skip migrations.
5. Stop releases and other migration processes for the target until the
   baseline transaction and the following normal migration command finish.

Never put a database URL on the command line. Run:

```sh
DATABASE_URL="$DATABASE_URL" pnpm run db:baseline -- \
  --target '<database-host>:5432/<database-name>' \
  --through '<checked-in-migration-tag>' \
  --backup-confirmed \
  --recovery-confirmed
```

The command refuses to run without all three explicit confirmations. It
connects with a single connection, takes a transaction advisory lock, and
compares the public catalog with the snapshot for the selected migration tag
before writing anything. Tables, columns, types, nullability, defaults,
primary keys, foreign keys, indexes, unique and check constraints, row-level
security settings, policies, serial sequences, ownership, grants, and
standalone catalog objects must match exactly. The command permits a configured
ledger table only when it contains zero rows and has the canonical Drizzle
table, index, sequence, ownership, and access-control shape. The database owner,
public schema ACL, and migration role's default privileges must also be
canonical, and a newly created ledger is revalidated before history is inserted.

If verification succeeds, the only write is creation of the `drizzle` schema
and its `__drizzle_migrations` table when absent, followed by the ledger prefix
through the selected migration. No application table, row, sequence, or
constraint is created, altered, or deleted. Each row uses the checked-in SQL
file's SHA-256 and journal timestamp, matching Drizzle's normal ledger format.

Afterward, run the normal checked-in migration path:

```sh
pnpm --filter @workspace/db run migrate
```

That command applies any later checked-in migrations. If the baseline command
refuses the target, stop and investigate; do not use `push`, `push --force`, or
manual `DROP`/`DELETE` statements to make it pass.

## Fresh databases

Do not run the baseline procedure for a fresh database. A fresh database has no
application tables and must continue to use:

```sh
pnpm --filter @workspace/db run migrate
```

Drizzle creates its migration schema and applies the full checked-in chain in
order. The release check continues to use this same non-interactive path. Its
catalog preflight refuses any target with public tables but no configured
Drizzle ledger, preventing an accidental attempt to recreate legacy tables.