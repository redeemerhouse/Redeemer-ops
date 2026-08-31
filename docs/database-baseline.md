# Legacy database baseline procedure

This is a one-time procedure for a database that was initialized by the retired
schema-push workflow and has the legacy `0000_initial_schema` shape but no
Drizzle migration ledger. It is not a general schema repair tool.

## Before running it

An operator must:

1. Select the target explicitly as the credential-free
   `host:port/database-name` identity from `DATABASE_URL`. The command compares
   that exact identity with the URL and confirms the connected database name.
2. Take, or confirm the existence of, a restorable backup for that exact
   database.
3. Confirm that the tested recovery/PITR procedure can recover that database.
4. Confirm that the database has only the schema represented by
   `lib/db/drizzle/0000_initial_schema.sql`. A database that already contains
   later migration tables or columns must not be baselined; use a reviewed
   forward migration plan instead.
5. Stop releases and other migration processes for the target until the
   baseline transaction and the following normal migration command finish.

Never put a database URL on the command line. Run:

```sh
DATABASE_URL="$DATABASE_URL" pnpm run db:baseline -- \
  --target '<database-host>:5432/<database-name>' \
  --backup-confirmed \
  --recovery-confirmed
```

The command refuses to run without all three explicit confirmations. It
connects with a single connection, takes a transaction advisory lock, and
checks the public catalog before writing anything. It verifies the expected
eight tables, columns, types, nullability, defaults, primary keys, and the
payments-to-residents foreign key. It also rejects unexpected indexes,
sequences, triggers, row-level-security settings and policies, views,
functions, schemas, explicit grants, rules, standalone types, or object
ownership. It refuses a database where a Drizzle ledger already exists.

If verification succeeds, the only write is creation of the `drizzle` schema
and its `__drizzle_migrations` table followed by the ledger row for
`0000_initial_schema`. No application table, row, sequence, or constraint is
created, altered, or deleted. The row uses the checked-in SQL file's SHA-256
and journal timestamp, matching Drizzle's normal ledger format.

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