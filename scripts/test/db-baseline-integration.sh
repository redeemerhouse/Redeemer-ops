#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
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

assert_baseline_refused() {
  local database="$1"
  local sql="$2"
  create_legacy_database "$database"
  "$PG_BIN/psql" \
    "$BASE_URL/$database" \
    -v ON_ERROR_STOP=1 \
    -c "$sql" >/dev/null

  set +e
  (
    cd "$ROOT"
    DATABASE_URL="$BASE_URL/$database" pnpm run db:baseline -- \
      --target "$TARGET/$database" \
      --backup-confirmed \
      --recovery-confirmed
  ) >"$TMP_ROOT/$database.log" 2>&1
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
  cd "$ROOT"
  DATABASE_URL="$BASE_URL/valid_legacy" pnpm run db:baseline -- \
    --target "$TARGET/valid_legacy" \
    --backup-confirmed \
    --recovery-confirmed
  DATABASE_URL="$BASE_URL/valid_legacy" pnpm run db:release-check
) >"$TMP_ROOT/valid-legacy.log"
test "$("$PG_BIN/psql" "$BASE_URL/valid_legacy" -Atc \
  "SELECT count(*) FROM residents")" = "1"
test "$("$PG_BIN/psql" "$BASE_URL/valid_legacy" -Atc \
  "SELECT count(*) FROM drizzle.__drizzle_migrations")" = "5"

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
  "SELECT count(*) FROM drizzle.__drizzle_migrations")" = "5"

echo "Database baseline PostgreSQL integration tests passed."