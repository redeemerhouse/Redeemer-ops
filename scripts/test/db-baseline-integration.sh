#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export APP_ENVIRONMENT=test
export DATABASE_TARGET=disposable-test
export DISPOSABLE_DATABASE_CONFIRMATION=create-and-drop-disposable-database
export PAYMENT_PROVIDER_MODE=disabled
export STORAGE_MODE=synthetic
export EMAIL_MODE=disabled
export RELEASE_PROMOTION=test
PG_BIN="$(dirname "$(command -v postgres)")"
TMP_ROOT="$(mktemp -d /tmp/db-baseline-integration.XXXXXX)"
PGDATA="$TMP_ROOT/data"
SOCKET_DIR="$TMP_ROOT/socket"
PORT="${DB_BASELINE_TEST_PORT:-55443}"
BASE_URL="postgresql://postgres@127.0.0.1:$PORT"
TARGET="127.0.0.1:$PORT"

cleanup() {
  "$PG_BIN/pg_ctl" -D "$PGDATA" -m fast stop >/dev/null 2>&1 || true
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

mkdir -p "$SOCKET_DIR"
"$PG_BIN/initdb" -D "$PGDATA" -A trust -U postgres >/dev/null
"$PG_BIN/pg_ctl" \
  -D "$PGDATA" \
  -o "-p $PORT -k $SOCKET_DIR -h 127.0.0.1" \
  -w start >/dev/null

create_legacy_database() {
  local database="$1"
  "$PG_BIN/createdb" -h 127.0.0.1 -p "$PORT" -U postgres "$database"
  "$PG_BIN/psql" \
    "$BASE_URL/$database" \
    -v ON_ERROR_STOP=1 \
    -f "$ROOT/lib/db/drizzle/0000_initial_schema.sql" >/dev/null
}

run_baseline() {
  local database="$1"
  local through="${2:-0000_initial_schema}"
  local evidence="$TMP_ROOT/$database-evidence.json"
  cat >"$evidence" <<EOF
{
  "version": 1,
  "backupCreatedAt": "2026-09-03T14:30:00Z",
  "target": "$TARGET/$database",
  "migrationBoundary": "$through",
  "backupSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "retainedArtifactId": "approved-vault/$database",
  "encryptedDestinationApproved": true,
  "restore": {
    "testedAt": "2026-09-03T15:00:00Z",
    "result": "succeeded",
    "procedure": "docs/database-baseline.md#restore-drill"
  },
  "retainUntil": "2027-09-03"
}
EOF
  (
    cd "$ROOT"
    DATABASE_URL="$BASE_URL/$database" pnpm run db:baseline -- \
      --target "$TARGET/$database" \
      --through "$through" \
      --evidence-manifest "$evidence"
  )
}

checked_in_migration_count="$(
  node -e 'console.log(require(process.argv[1]).entries.length)' \
    "$ROOT/lib/db/drizzle/meta/_journal.json"
)"
mapfile -t migration_tags < <(
  node -e 'for (const entry of require(process.argv[1]).entries) console.log(entry.tag)' \
    "$ROOT/lib/db/drizzle/meta/_journal.json"
)

assert_baseline_refused() {
  local database="$1"
  local sql="$2"
  create_legacy_database "$database"
  "$PG_BIN/psql" \
    "$BASE_URL/$database" \
    -v ON_ERROR_STOP=1 \
    -c "$sql" >/dev/null

  set +e
  run_baseline "$database" >"$TMP_ROOT/$database.log" 2>&1
  local status=$?
  set -e

  if [[ "$status" -eq 0 ]]; then
    echo "Expected baseline refusal for $database" >&2
    cat "$TMP_ROOT/$database.log" >&2
    exit 1
  fi
  if [[ "$("$PG_BIN/psql" "$BASE_URL/$database" -Atc \
    "SELECT to_regclass('drizzle.__drizzle_migrations') IS NULL")" != "t" ]]; then
    echo "Baseline refusal wrote a ledger for $database" >&2
    exit 1
  fi
}

create_legacy_database valid_legacy
"$PG_BIN/psql" "$BASE_URL/valid_legacy" -v ON_ERROR_STOP=1 -c "
  INSERT INTO residents
    (name, email, phone, home, move_in_date, next_payment_date)
  VALUES
    ('Fixture', 'fixture@example.test', '555', 'House', '2026-01-01', '2026-01-08')
" >/dev/null
(
  run_baseline valid_legacy
  DATABASE_URL="$BASE_URL/valid_legacy" DB_WRITES_FROZEN=true \
    pnpm run db:release-check
) >"$TMP_ROOT/valid-legacy.log"
test "$("$PG_BIN/psql" "$BASE_URL/valid_legacy" -Atc \
  "SELECT count(*) FROM residents")" = "1"
test "$("$PG_BIN/psql" "$BASE_URL/valid_legacy" -Atc \
  "SELECT count(*) FROM drizzle.__drizzle_migrations")" = "$checked_in_migration_count"

create_legacy_database mismatched_evidence
set +e
(
  cd "$ROOT"
  DATABASE_URL="$BASE_URL/mismatched_evidence" pnpm run db:baseline -- \
    --target "$TARGET/mismatched_evidence" \
    --evidence-manifest "$TMP_ROOT/valid_legacy-evidence.json"
) >"$TMP_ROOT/mismatched-evidence.log" 2>&1
status=$?
set -e
test "$status" -ne 0
grep -q "target must exactly match" "$TMP_ROOT/mismatched-evidence.log"
test "$("$PG_BIN/psql" "$BASE_URL/mismatched_evidence" -Atc \
  "SELECT to_regclass('drizzle.__drizzle_migrations') IS NULL")" = "t"

through_index=8
through_tag="${migration_tags[$through_index]}"
"$PG_BIN/createdb" -h 127.0.0.1 -p "$PORT" -U postgres adopted_prefix
for ((index = 0; index <= through_index; index += 1)); do
  "$PG_BIN/psql" \
    "$BASE_URL/adopted_prefix" \
    -v ON_ERROR_STOP=1 \
    -f "$ROOT/lib/db/drizzle/${migration_tags[$index]}.sql" >/dev/null
done
"$PG_BIN/psql" "$BASE_URL/adopted_prefix" -v ON_ERROR_STOP=1 -c '
  CREATE SCHEMA drizzle;
  CREATE TABLE drizzle.__drizzle_migrations (
    id SERIAL PRIMARY KEY,
    hash text NOT NULL,
    created_at bigint
  )
' >/dev/null
(
  run_baseline adopted_prefix "$through_tag"
  DATABASE_URL="$BASE_URL/adopted_prefix" DB_WRITES_FROZEN=true \
    pnpm run db:release-check
) >"$TMP_ROOT/adopted-prefix.log"
test "$("$PG_BIN/psql" "$BASE_URL/adopted_prefix" -Atc \
  "SELECT count(*) FROM drizzle.__drizzle_migrations")" = "$checked_in_migration_count"

for database in \
  later_extra_trigger \
  malformed_empty_ledger \
  ledger_sequence_grant \
  ledger_sequence_owner
do
  "$PG_BIN/createdb" -h 127.0.0.1 -p "$PORT" -U postgres "$database"
  for ((index = 0; index <= through_index; index += 1)); do
    "$PG_BIN/psql" \
      "$BASE_URL/$database" \
      -v ON_ERROR_STOP=1 \
      -f "$ROOT/lib/db/drizzle/${migration_tags[$index]}.sql" >/dev/null
  done
done
"$PG_BIN/psql" "$BASE_URL/later_extra_trigger" -v ON_ERROR_STOP=1 -c '
  CREATE SCHEMA drizzle;
  CREATE TABLE drizzle.__drizzle_migrations (
    id SERIAL PRIMARY KEY,
    hash text NOT NULL,
    created_at bigint
  );
  CREATE FUNCTION reject_later_write() RETURNS trigger
  LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
  CREATE TRIGGER residents_later_extra_trigger
  BEFORE INSERT ON residents
  FOR EACH ROW EXECUTE FUNCTION reject_later_write()
' >/dev/null
"$PG_BIN/psql" "$BASE_URL/malformed_empty_ledger" -v ON_ERROR_STOP=1 -c '
  CREATE SCHEMA drizzle;
  CREATE TABLE drizzle.__drizzle_migrations (
    id integer,
    hash text NOT NULL,
    created_at bigint,
    unexpected text
  )
' >/dev/null
for database in ledger_sequence_grant ledger_sequence_owner; do
  "$PG_BIN/psql" "$BASE_URL/$database" -v ON_ERROR_STOP=1 -c '
    CREATE SCHEMA drizzle;
    CREATE TABLE drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  ' >/dev/null
done
"$PG_BIN/psql" "$BASE_URL/ledger_sequence_grant" -v ON_ERROR_STOP=1 -c '
  GRANT USAGE ON SEQUENCE drizzle.__drizzle_migrations_id_seq TO PUBLIC
' >/dev/null
"$PG_BIN/psql" "$BASE_URL/ledger_sequence_owner" -v ON_ERROR_STOP=1 -c '
  CREATE ROLE baseline_ledger_sequence_owner;
  ALTER SEQUENCE drizzle.__drizzle_migrations_id_seq OWNED BY NONE;
  ALTER SEQUENCE drizzle.__drizzle_migrations_id_seq
    OWNER TO baseline_ledger_sequence_owner
' >/dev/null
for database in \
  later_extra_trigger \
  malformed_empty_ledger \
  ledger_sequence_grant \
  ledger_sequence_owner
do
  set +e
  run_baseline "$database" "$through_tag" >"$TMP_ROOT/$database.log" 2>&1
  status=$?
  set -e
  if [[ "$status" -eq 0 ]]; then
    echo "Expected later-snapshot baseline refusal for $database" >&2
    cat "$TMP_ROOT/$database.log" >&2
    exit 1
  fi
  test "$("$PG_BIN/psql" "$BASE_URL/$database" -Atc \
    "SELECT count(*) FROM drizzle.__drizzle_migrations")" = "0"
done

"$PG_BIN/createdb" -h 127.0.0.1 -p "$PORT" -U postgres hostile_drizzle_schema
for ((index = 0; index <= through_index; index += 1)); do
  "$PG_BIN/psql" \
    "$BASE_URL/hostile_drizzle_schema" \
    -v ON_ERROR_STOP=1 \
    -f "$ROOT/lib/db/drizzle/${migration_tags[$index]}.sql" >/dev/null
done
"$PG_BIN/psql" "$BASE_URL/hostile_drizzle_schema" -v ON_ERROR_STOP=1 -c '
  CREATE SCHEMA drizzle;
  CREATE FUNCTION drizzle.unexpected_function() RETURNS integer
  LANGUAGE sql AS $$ SELECT 1 $$
' >/dev/null
set +e
run_baseline hostile_drizzle_schema "$through_tag" \
  >"$TMP_ROOT/hostile_drizzle_schema.log" 2>&1
status=$?
set -e
if [[ "$status" -eq 0 ]]; then
  echo "Expected refusal for a pre-existing noncanonical drizzle schema" >&2
  cat "$TMP_ROOT/hostile_drizzle_schema.log" >&2
  exit 1
fi
test "$("$PG_BIN/psql" "$BASE_URL/hostile_drizzle_schema" -Atc \
  "SELECT to_regclass('drizzle.__drizzle_migrations') IS NULL")" = "t"

for database in later_not_valid_fk later_deferrable_fk; do
  "$PG_BIN/createdb" -h 127.0.0.1 -p "$PORT" -U postgres "$database"
  for ((index = 0; index <= through_index; index += 1)); do
    "$PG_BIN/psql" \
      "$BASE_URL/$database" \
      -v ON_ERROR_STOP=1 \
      -f "$ROOT/lib/db/drizzle/${migration_tags[$index]}.sql" >/dev/null
  done
done
"$PG_BIN/psql" "$BASE_URL/later_not_valid_fk" -v ON_ERROR_STOP=1 -c '
  ALTER TABLE payments
    DROP CONSTRAINT payments_resident_id_residents_id_fk;
  ALTER TABLE payments
    ADD CONSTRAINT payments_resident_id_residents_id_fk
    FOREIGN KEY (resident_id) REFERENCES residents(id) NOT VALID
' >/dev/null
"$PG_BIN/psql" "$BASE_URL/later_deferrable_fk" -v ON_ERROR_STOP=1 -c '
  ALTER TABLE payments
    DROP CONSTRAINT payments_resident_id_residents_id_fk;
  ALTER TABLE payments
    ADD CONSTRAINT payments_resident_id_residents_id_fk
    FOREIGN KEY (resident_id) REFERENCES residents(id)
    DEFERRABLE INITIALLY DEFERRED
' >/dev/null
for database in later_not_valid_fk later_deferrable_fk; do
  set +e
  run_baseline "$database" "$through_tag" >"$TMP_ROOT/$database.log" 2>&1
  status=$?
  set -e
  if [[ "$status" -eq 0 ]]; then
    echo "Expected refusal for divergent foreign-key state in $database" >&2
    cat "$TMP_ROOT/$database.log" >&2
    exit 1
  fi
  test "$("$PG_BIN/psql" "$BASE_URL/$database" -Atc \
    "SELECT to_regclass('drizzle.__drizzle_migrations') IS NULL")" = "t"
done

for database in later_not_valid_check later_deferrable_primary_key; do
  "$PG_BIN/createdb" -h 127.0.0.1 -p "$PORT" -U postgres "$database"
  for ((index = 0; index <= through_index; index += 1)); do
    "$PG_BIN/psql" \
      "$BASE_URL/$database" \
      -v ON_ERROR_STOP=1 \
      -f "$ROOT/lib/db/drizzle/${migration_tags[$index]}.sql" >/dev/null
  done
done
"$PG_BIN/psql" "$BASE_URL/later_not_valid_check" -v ON_ERROR_STOP=1 -c "
  ALTER TABLE residents DROP CONSTRAINT residents_status_allowed;
  ALTER TABLE residents
    ADD CONSTRAINT residents_status_allowed
    CHECK (status IN ('active', 'pending', 'exited')) NOT VALID
" >/dev/null
"$PG_BIN/psql" "$BASE_URL/later_deferrable_primary_key" -v ON_ERROR_STOP=1 -c '
  ALTER TABLE api_rate_limit_buckets
    DROP CONSTRAINT api_rate_limit_buckets_pkey;
  ALTER TABLE api_rate_limit_buckets
    ADD CONSTRAINT api_rate_limit_buckets_pkey
    PRIMARY KEY (key) DEFERRABLE INITIALLY DEFERRED
' >/dev/null
for database in later_not_valid_check later_deferrable_primary_key; do
  set +e
  run_baseline "$database" "$through_tag" >"$TMP_ROOT/$database.log" 2>&1
  status=$?
  set -e
  if [[ "$status" -eq 0 ]]; then
    echo "Expected refusal for noncanonical constraint state in $database" >&2
    cat "$TMP_ROOT/$database.log" >&2
    exit 1
  fi
  test "$("$PG_BIN/psql" "$BASE_URL/$database" -Atc \
    "SELECT to_regclass('drizzle.__drizzle_migrations') IS NULL")" = "t"
done

for database in public_schema_grant default_table_privileges; do
  "$PG_BIN/createdb" -h 127.0.0.1 -p "$PORT" -U postgres "$database"
  for ((index = 0; index <= through_index; index += 1)); do
    "$PG_BIN/psql" \
      "$BASE_URL/$database" \
      -v ON_ERROR_STOP=1 \
      -f "$ROOT/lib/db/drizzle/${migration_tags[$index]}.sql" >/dev/null
  done
done
"$PG_BIN/psql" "$BASE_URL/public_schema_grant" -v ON_ERROR_STOP=1 -c '
  GRANT CREATE ON SCHEMA public TO PUBLIC
' >/dev/null
"$PG_BIN/psql" "$BASE_URL/default_table_privileges" -v ON_ERROR_STOP=1 -c '
  ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO PUBLIC
' >/dev/null
for database in public_schema_grant default_table_privileges; do
  set +e
  run_baseline "$database" "$through_tag" >"$TMP_ROOT/$database.log" 2>&1
  status=$?
  set -e
  if [[ "$status" -eq 0 ]]; then
    echo "Expected refusal for noncanonical database privileges in $database" >&2
    cat "$TMP_ROOT/$database.log" >&2
    exit 1
  fi
  test "$("$PG_BIN/psql" "$BASE_URL/$database" -Atc \
    "SELECT to_regclass('drizzle.__drizzle_migrations') IS NULL")" = "t"
done

assert_baseline_refused extra_index \
  "CREATE UNIQUE INDEX residents_email_extra_unique ON residents(email)"
assert_baseline_refused extra_trigger "
  CREATE FUNCTION reject_resident_write() RETURNS trigger
  LANGUAGE plpgsql AS \$\$ BEGIN RETURN NEW; END \$\$;
  CREATE TRIGGER residents_extra_trigger
  BEFORE INSERT ON residents
  FOR EACH ROW EXECUTE FUNCTION reject_resident_write()
"
assert_baseline_refused enabled_rls "
  ALTER TABLE residents ENABLE ROW LEVEL SECURITY;
  CREATE POLICY residents_extra_policy ON residents USING (true)
"
assert_baseline_refused extra_view \
  "CREATE VIEW residents_extra_view AS SELECT id FROM residents"
assert_baseline_refused extra_function "
  CREATE FUNCTION residents_extra_function() RETURNS integer
  LANGUAGE sql AS \$\$ SELECT 1 \$\$
"
assert_baseline_refused extra_sequence \
  "CREATE SEQUENCE residents_extra_sequence"
assert_baseline_refused extra_grant "
  CREATE ROLE baseline_reader;
  GRANT SELECT ON residents TO baseline_reader
"
assert_baseline_refused extra_schema \
  "CREATE SCHEMA legacy_extra"

"$PG_BIN/createdb" -h 127.0.0.1 -p "$PORT" -U postgres fresh
(
  cd "$ROOT"
  DATABASE_URL="$BASE_URL/fresh" pnpm run db:release-check
) >"$TMP_ROOT/fresh.log"
test "$("$PG_BIN/psql" "$BASE_URL/fresh" -Atc \
  "SELECT count(*) FROM drizzle.__drizzle_migrations")" = "$checked_in_migration_count"

echo "Database baseline PostgreSQL integration tests passed."