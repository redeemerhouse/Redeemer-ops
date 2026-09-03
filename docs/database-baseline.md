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
2. Create a PostgreSQL custom-format backup (`pg_dump --format=custom`) for that
   exact database without printing `DATABASE_URL` or redirecting verbose output.
3. Copy the backup to the organization's approved access-controlled,
   encrypted-at-rest backup destination. The repository and `/tmp` are not
   approved destinations. Record only the destination's credential-free object
   ID; never record a URL, token, key, local backup path, or backup contents.
4. Restore the retained object (not the temporary source copy) into an isolated,
   empty drill database and run the verification steps in
   [Restore drill](#restore-drill).
5. Select the exact checked-in migration tag whose snapshot is expected to
   match the live catalog. Do not choose a later tag merely to skip migrations.
6. Stop releases and other migration processes for the target until the
   baseline transaction and the following normal migration command finish.

Create the evidence manifest outside the repository with mode `0600`. It is
credential-free and may be retained with the encrypted backup:

```json
{
  "version": 1,
  "backupCreatedAt": "2026-09-03T14:30:00Z",
  "target": "database-host:5432/database-name",
  "migrationBoundary": "0000_initial_schema",
  "backupSha256": "64-lowercase-hex-characters",
  "retainedArtifactId": "approved-backup-vault/object-id",
  "encryptedDestinationApproved": true,
  "restore": {
    "testedAt": "2026-09-03T15:00:00Z",
    "result": "succeeded",
    "procedure": "docs/database-baseline.md#restore-drill"
  },
  "retainUntil": "2027-09-03"
}
```

Compute `backupSha256` from the retained artifact after downloading it for the
drill, not from an object-store checksum that may use another algorithm. Set
`retainUntil` according to the approved data-retention policy.

Never put a database URL or backup path on the command line. Run:

```sh
DATABASE_URL="$DATABASE_URL" pnpm run db:baseline -- \
  --target '<database-host>:5432/<database-name>' \
  --through '<checked-in-migration-tag>' \
  --evidence-manifest "$RECOVERY_EVIDENCE_MANIFEST"
```

The command validates every evidence field and refuses a target or migration
boundary that does not exactly match the manifest. It rejects destination
identifiers that resemble URLs or credentials. It
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

## Restore drill

1. Download the retained encrypted backup into a new mode-`0700` temporary
   directory. Supply storage and database credentials through the approved
   secret mechanism, never command arguments or shell tracing.
2. Disable shell tracing (`set +x`). Compare `sha256sum` of the downloaded file
   with `backupSha256` in the manifest. Stop on any mismatch.
3. Create a new empty drill database on an isolated PostgreSQL instance with the
   same major version as the source.
4. Restore with `pg_restore --exit-on-error --no-owner --no-privileges
   --dbname "$DRILL_DATABASE_URL" "$BACKUP_FILE"`. Keep command output in the
   restricted maintenance session; do not commit it.
5. Confirm `pg_restore --list "$BACKUP_FILE"` succeeds, connect to the drill
   database, and verify expected application tables and a representative
   aggregate count. Do not print row contents.
6. Drop the drill database and securely remove the downloaded temporary copy.
   Record the drill timestamp, `succeeded` result, and this procedure identifier
   in the manifest. Upload the finalized manifest beside the retained object.

To reproduce the drill later, retrieve the retained object and its manifest,
repeat steps 1–6, and confirm the checksum before restoring. A failed checksum,
restore, or verification invalidates the evidence and must block baselining.

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