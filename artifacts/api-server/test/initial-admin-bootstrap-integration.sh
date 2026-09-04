#!/usr/bin/env bash
set -Eeuo pipefail
export PGSSLROOTCERT="${PGSSLROOTCERT:-system}"

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
ADMIN_URL="${TEST_DATABASE_ADMIN_URL:-}"
CONFIRMATION="${INITIAL_ADMIN_TEST_DB_CONFIRM:-}"
DB_NAME="initial_admin_bootstrap_test_${USER:-runner}_$$_${RANDOM}"
PORT_NUMBER="${INITIAL_ADMIN_TEST_PORT:-$((19000 + ($$ % 1000)))}"
BASE_URL="http://127.0.0.1:${PORT_NUMBER}/api"
SETUP_CODE="initial-admin-bootstrap-test-code"
PASSWORD="ValidPassword123"
TEMP_DIR="$(mktemp -d /tmp/initial-admin-bootstrap.XXXXXX)"
SERVER_PID=""

fail() {
  echo "INITIAL ADMIN BOOTSTRAP TEST FAIL: $*" >&2
  exit 1
}

cleanup() {
  local status=$?
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  if [[ -n "$ADMIN_URL" ]]; then
    dropdb --maintenance-db="$ADMIN_URL" --if-exists "$DB_NAME" >/dev/null 2>&1 || true
  fi
  if [[ $status -eq 0 ]]; then
    rm -rf "$TEMP_DIR"
  else
    echo "Initial administrator bootstrap diagnostics retained at $TEMP_DIR" >&2
  fi
}
trap cleanup EXIT
trap 'echo "initial administrator bootstrap test failed at line $LINENO" >&2' ERR

[[ "${NODE_ENV:-test}" != "production" ]] || fail "NODE_ENV=production is forbidden."
[[ -z "${REPLIT_DEPLOYMENT:-}" ]] || fail "Replit deployment runtimes are forbidden."
[[ -n "$ADMIN_URL" ]] || fail "TEST_DATABASE_ADMIN_URL is required. Never point this at production."
[[ "$CONFIRMATION" == "create-and-drop-disposable-database" ]] ||
  fail "Set INITIAL_ADMIN_TEST_DB_CONFIRM=create-and-drop-disposable-database after confirming the admin URL is non-production."

node - "$ADMIN_URL" <<'NODE' || fail "Database URL is not safe for disposable test database creation."
const url = new URL(process.argv[2]);
if (!["postgres:", "postgresql:"].includes(url.protocol)) process.exit(1);
const identity = `${url.hostname}/${url.pathname}`.toLowerCase();
if (/(^|[-_.\/])(prod|production|live)([-_.\/]|$)/.test(identity)) process.exit(1);
NODE

command -v createdb >/dev/null || fail "createdb is required."
command -v dropdb >/dev/null || fail "dropdb is required."
command -v psql >/dev/null || fail "psql is required."

createdb --maintenance-db="$ADMIN_URL" "$DB_NAME"
TEST_DATABASE_URL="$(
  node -e 'const url = new URL(process.argv[1]); url.pathname = `/${process.argv[2]}`; url.searchParams.delete("options"); console.log(url.toString())' "$ADMIN_URL" "$DB_NAME"
)"

DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @workspace/db run migrate >"$TEMP_DIR/migrate.log"

start_server() {
  local setup_code="$1"
  local log_name="$2"
  DATABASE_URL="$TEST_DATABASE_URL" SESSION_SECRET="bootstrap-session-secret-0000000000000000" \
    INITIAL_ADMIN_SETUP_TOKEN="$setup_code" NODE_ENV=test PORT="$PORT_NUMBER" \
    API_RATE_LIMIT_STORE=memory \
    node "$ROOT_DIR/artifacts/api-server/dist/index.mjs" >"$TEMP_DIR/$log_name" 2>&1 &
  SERVER_PID=$!

  for _ in $(seq 1 60); do
    curl -fsS "$BASE_URL/healthz" >/dev/null 2>&1 && break
    sleep 0.25
  done
  curl -fsS "$BASE_URL/healthz" >/dev/null || fail "API did not become ready."
}

start_server "too-short" "short-token-server.log"
curl -fsS "$BASE_URL/auth/bootstrap" >"$TEMP_DIR/bootstrap-short-token.json"
node -e 'const body=require(process.argv[1]); if (body.available !== false) process.exit(1)' \
  "$TEMP_DIR/bootstrap-short-token.json" || fail "Setup was advertised with an unusable short setup code."
kill "$SERVER_PID"
wait "$SERVER_PID"
SERVER_PID=""

start_server "$SETUP_CODE" "server.log"

curl -fsS "$BASE_URL/auth/bootstrap" >"$TEMP_DIR/bootstrap-before.json"
node -e 'const body=require(process.argv[1]); if (body.available !== true) process.exit(1)' \
  "$TEMP_DIR/bootstrap-before.json" || fail "Setup was not available on an empty database."

status="$(
  curl -sS -o "$TEMP_DIR/bootstrap-invalid.json" -w '%{http_code}' \
    -H 'content-type: application/json' \
    -d "{\"firstName\":\"Wrong\",\"lastName\":\"Code\",\"email\":\"wrong-code@redeemer.invalid\",\"password\":\"$PASSWORD\",\"passwordConfirmation\":\"$PASSWORD\",\"setupCode\":\"incorrect-bootstrap-code\"}" \
    "$BASE_URL/auth/bootstrap"
)"
[[ "$status" == "403" ]] || fail "Incorrect setup code was not rejected."
[[ "$(psql "$TEST_DATABASE_URL" -qAtc 'select count(*) from auth_accounts;')" == "0" ]] ||
  fail "Incorrect setup code created an account."

status="$(
  curl -sS -o "$TEMP_DIR/register-stranded.json" -w '%{http_code}' \
    -H 'content-type: application/json' \
    -d "{\"firstName\":\"Pending\",\"lastName\":\"Owner\",\"email\":\"pending-owner@redeemer.invalid\",\"password\":\"$PASSWORD\",\"passwordConfirmation\":\"$PASSWORD\"}" \
    "$BASE_URL/auth/register"
)"
[[ "$status" == "202" ]] || fail "Could not create the pending account recovery fixture."
curl -fsS "$BASE_URL/auth/bootstrap" >"$TEMP_DIR/bootstrap-recovery-available.json"
node -e 'const body=require(process.argv[1]); if (body.available !== true) process.exit(1)' \
  "$TEMP_DIR/bootstrap-recovery-available.json" || fail "Setup was not available for exactly one recoverable pending account."

status="$(
  curl -sS -o "$TEMP_DIR/bootstrap-recovery-wrong-password.json" -w '%{http_code}' \
    -H 'content-type: application/json' \
    -d "{\"firstName\":\"Pending\",\"lastName\":\"Owner\",\"email\":\"pending-owner@redeemer.invalid\",\"password\":\"WrongPassword123\",\"passwordConfirmation\":\"WrongPassword123\",\"setupCode\":\"$SETUP_CODE\"}" \
    "$BASE_URL/auth/bootstrap"
)"
[[ "$status" == "409" ]] || fail "Pending-account recovery accepted the wrong password."
[[ "$(psql "$TEST_DATABASE_URL" -qAtc "select account_status || ':' || coalesce(role, 'unassigned') from auth_accounts where email='pending-owner@redeemer.invalid';")" == "pending:unassigned" ]] ||
  fail "A failed recovery attempt changed the pending account."

status="$(
  curl -sS -o "$TEMP_DIR/bootstrap-recovery.json" -w '%{http_code}' \
    -H 'content-type: application/json' \
    -d "{\"firstName\":\"Recovered\",\"lastName\":\"Owner\",\"email\":\"pending-owner@redeemer.invalid\",\"password\":\"$PASSWORD\",\"passwordConfirmation\":\"$PASSWORD\",\"setupCode\":\"$SETUP_CODE\"}" \
    "$BASE_URL/auth/bootstrap"
)"
[[ "$status" == "201" ]] || fail "Valid pending-account recovery was rejected."
[[ "$(psql "$TEST_DATABASE_URL" -qAtc "select account_status || ':' || role || ':' || (email_verified_at is not null)::text from auth_accounts where email='pending-owner@redeemer.invalid';")" == "active:owner_admin:true" ]] ||
  fail "Pending-account recovery did not create an active verified owner."

psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -q \
  -c 'TRUNCATE auth_action_tokens, auth_sessions, auth_account_houses, auth_accounts RESTART IDENTITY CASCADE;'

bootstrap_attempt() {
  local suffix="$1"
  curl -sS -o "$TEMP_DIR/bootstrap-${suffix}.json" -w '%{http_code}' \
    -H 'content-type: application/json' \
    -d "{\"firstName\":\"Concurrent\",\"lastName\":\"Owner\",\"email\":\"owner-${suffix}@redeemer.invalid\",\"password\":\"$PASSWORD\",\"passwordConfirmation\":\"$PASSWORD\",\"setupCode\":\"$SETUP_CODE\"}" \
    "$BASE_URL/auth/bootstrap" >"$TEMP_DIR/bootstrap-${suffix}.status"
}

bootstrap_attempt one &
first_pid=$!
bootstrap_attempt two &
second_pid=$!
wait "$first_pid"
wait "$second_pid"

statuses="$(sort "$TEMP_DIR/bootstrap-one.status" "$TEMP_DIR/bootstrap-two.status" | tr '\n' ' ')"
[[ "$statuses" == "201 409 " ]] || fail "Concurrent bootstrap attempts returned unexpected statuses: $statuses"

[[ "$(psql "$TEST_DATABASE_URL" -qAtc 'select count(*) from auth_accounts;')" == "1" ]] ||
  fail "Concurrent setup created more than one account."
[[ "$(
  psql "$TEST_DATABASE_URL" -qAtc \
    "select count(*) from auth_accounts
     where account_status='active' and role='owner_admin'
       and email_verified_at is not null and approved_at is not null;"
)" == "1" ]] ||
  fail "Concurrent setup did not create exactly one active, approved owner administrator."

curl -fsS "$BASE_URL/auth/bootstrap" >"$TEMP_DIR/bootstrap-after.json"
node -e 'const body=require(process.argv[1]); if (body.available !== false) process.exit(1)' \
  "$TEMP_DIR/bootstrap-after.json" || fail "Setup remained available after the first account."

status="$(
  curl -sS -o "$TEMP_DIR/bootstrap-closed.json" -w '%{http_code}' \
    -H 'content-type: application/json' \
    -d "{\"firstName\":\"Late\",\"lastName\":\"Owner\",\"email\":\"late-owner@redeemer.invalid\",\"password\":\"$PASSWORD\",\"passwordConfirmation\":\"$PASSWORD\",\"setupCode\":\"$SETUP_CODE\"}" \
    "$BASE_URL/auth/bootstrap"
)"
[[ "$status" == "409" ]] || fail "Setup did not close permanently after the first account."

status="$(
  curl -sS -o "$TEMP_DIR/register.json" -w '%{http_code}' \
    -H 'content-type: application/json' \
    -d "{\"firstName\":\"Ordinary\",\"lastName\":\"Registrant\",\"email\":\"ordinary@redeemer.invalid\",\"password\":\"$PASSWORD\",\"passwordConfirmation\":\"$PASSWORD\",\"role\":\"owner_admin\",\"accountStatus\":\"active\"}" \
    "$BASE_URL/auth/register"
)"
[[ "$status" == "202" || "$status" == "503" ]] ||
  fail "Ordinary registration returned unexpected status $status."
[[ "$(psql "$TEST_DATABASE_URL" -qAtc "select account_status || ':' || coalesce(role, 'unassigned') from auth_accounts where email='ordinary@redeemer.invalid';")" == "pending:unassigned" ]] ||
  fail "Ordinary registration granted administrator access."

echo "initial administrator bootstrap integration passed"