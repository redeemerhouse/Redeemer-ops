#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
ADMIN_URL="${TEST_DATABASE_ADMIN_URL:-}"
CONFIRMATION="${CRITICAL_TEST_DB_CONFIRM:-}"
DB_NAME="critical_workflow_test_${USER:-runner}_$$_${RANDOM}"
API_PORT="${CRITICAL_TEST_API_PORT:-$((18000 + ($$ % 1000)))}"
WEB_PORT="${CRITICAL_TEST_WEB_PORT:-$((20000 + ($$ % 1000)))}"
API_BASE_URL="http://127.0.0.1:${API_PORT}/api"
WEB_BASE_URL="http://127.0.0.1:${WEB_PORT}"
TEMP_DIR="$(mktemp -d /tmp/critical-workflow-tests.XXXXXX)"
API_PID=""
WEB_PID=""

fail() {
  echo "CRITICAL WORKFLOW HARNESS FAIL: $*" >&2
  exit 1
}

cleanup() {
  local status=$?
  [[ -n "$WEB_PID" ]] && kill "$WEB_PID" 2>/dev/null || true
  [[ -n "$API_PID" ]] && kill "$API_PID" 2>/dev/null || true
  [[ -n "$WEB_PID" ]] && wait "$WEB_PID" 2>/dev/null || true
  [[ -n "$API_PID" ]] && wait "$API_PID" 2>/dev/null || true
  if [[ -n "$ADMIN_URL" ]]; then
    dropdb --maintenance-db="$ADMIN_URL" --if-exists "$DB_NAME" >/dev/null 2>&1 || true
  fi
  if [[ $status -ne 0 ]]; then
    echo "API log: $TEMP_DIR/api.log" >&2
    echo "Web log: $TEMP_DIR/web.log" >&2
  else
    rm -rf "$TEMP_DIR"
  fi
}
trap cleanup EXIT

[[ "${NODE_ENV:-test}" != "production" ]] || fail "NODE_ENV=production is forbidden."
[[ -z "${REPLIT_DEPLOYMENT:-}" ]] || fail "Replit deployment runtimes are forbidden."
[[ -n "$ADMIN_URL" ]] || fail "TEST_DATABASE_ADMIN_URL is required. Never point this at production."
[[ "$CONFIRMATION" == "create-and-drop-disposable-database" ]] ||
  fail "Set CRITICAL_TEST_DB_CONFIRM=create-and-drop-disposable-database after confirming the admin URL is non-production."

node - "$ADMIN_URL" <<'NODE' || fail "TEST_DATABASE_ADMIN_URL is not an allowed PostgreSQL maintenance URL."
const url = new URL(process.argv[2]);
if (!["postgres:", "postgresql:"].includes(url.protocol)) process.exit(1);
const joined = `${url.hostname}/${url.pathname}`.toLowerCase();
if (/(^|[-_.\/])(prod|production|live)([-_.\/]|$)/.test(joined)) process.exit(1);
NODE

command -v createdb >/dev/null || fail "createdb is required."
command -v dropdb >/dev/null || fail "dropdb is required."
command -v psql >/dev/null || fail "psql is required."

createdb --maintenance-db="$ADMIN_URL" "$DB_NAME"
TEST_DATABASE_URL="$(
  node -e 'const url = new URL(process.argv[1]); url.pathname = `/${process.argv[2]}`; url.searchParams.delete("options"); console.log(url.toString())' "$ADMIN_URL" "$DB_NAME"
)"

DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @workspace/db run migrate >"$TEMP_DIR/migrate.log"
psql "$TEST_DATABASE_URL" -f "$ROOT_DIR/artifacts/api-server/test/critical-workflow-fixtures.sql" >"$TEMP_DIR/fixtures.log"

if psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -c \
  "insert into payments(resident_id, amount, due_date, status) values (2147483647, 1.00, '2026-08-01', 'due')" \
  >"$TEMP_DIR/fk-check.log" 2>&1; then
  fail "payments.resident_id accepted a missing resident."
fi
if psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -c \
  "insert into meeting_attendance(meeting_type, meeting_date, women_attended, women_eligible) values ('recovery_meeting', '2026-08-01', 2, 1)" \
  >"$TEMP_DIR/check-constraint.log" 2>&1; then
  fail "meeting attendance accepted attended > eligible."
fi

pnpm --filter @workspace/api-server run build >"$TEMP_DIR/build.log"
DATABASE_URL="$TEST_DATABASE_URL" SESSION_SECRET="critical-workflow-test-secret-0000000000000000" \
  NODE_ENV=test PORT="$API_PORT" API_RATE_LIMIT_STORE=memory \
  CORS_ORIGINS="$WEB_BASE_URL" \
  node "$ROOT_DIR/artifacts/api-server/dist/index.mjs" >"$TEMP_DIR/api.log" 2>&1 &
API_PID=$!

for _ in $(seq 1 60); do
  curl -fsS "$API_BASE_URL/healthz" >/dev/null 2>&1 && break
  sleep 0.25
done
curl -fsS "$API_BASE_URL/healthz" >/dev/null || fail "API did not become ready."

status="$(
  curl -sS -o "$TEMP_DIR/bootstrap.json" -w '%{http_code}' \
    -H 'content-type: application/json' \
    -H 'x-initial-admin-token: critical-workflow-test-secret-0000000000000000' \
    -d '{"email":"critical-owner@redeemer.invalid","password":"CriticalPassword123"}' \
    "$API_BASE_URL/auth/bootstrap"
)"
[[ "$status" == "201" ]] || fail "Synthetic browser administrator bootstrap failed."

for suffix in desktop-chromium mobile-chromium; do
  pending_email="browser-pending-${suffix}@redeemer.invalid"
  status="$(
    curl -sS -o "$TEMP_DIR/register-${suffix}.json" -w '%{http_code}' \
      -H 'content-type: application/json' \
      -d "{\"firstName\":\"Browser\",\"lastName\":\"Pending\",\"email\":\"${pending_email}\",\"password\":\"CriticalPassword123\",\"passwordConfirmation\":\"CriticalPassword123\"}" \
      "$API_BASE_URL/auth/register"
  )"
  [[ "$status" == "202" ]] || fail "Synthetic pending browser account registration failed."
  psql "$TEST_DATABASE_URL" -qAtc \
    "update auth_accounts set email_verified_at=now() where email='${pending_email}' and account_status='pending';" >/dev/null
done

SESSION_SECRET="critical-workflow-test-secret-0000000000000000" \
  CRITICAL_API_BASE_URL="$API_BASE_URL" \
  node --test "$ROOT_DIR/artifacts/api-server/test/critical-workflows.test.mjs"

PORT="$WEB_PORT" BASE_PATH="/" NODE_ENV=test API_PROXY_TARGET="http://127.0.0.1:${API_PORT}" \
  pnpm --filter @workspace/recovery-housing-operations run dev >"$TEMP_DIR/web.log" 2>&1 &
WEB_PID=$!
for _ in $(seq 1 60); do
  curl -fsS "$WEB_BASE_URL/" >/dev/null 2>&1 && break
  sleep 0.25
done
curl -fsS "$WEB_BASE_URL/" >/dev/null || fail "Web app did not become ready."

E2E_BASE_URL="$WEB_BASE_URL" \
  pnpm --filter @workspace/recovery-housing-operations exec playwright test \
    --config test/playwright.config.ts \
    ${CRITICAL_PLAYWRIGHT_GREP:+--grep "$CRITICAL_PLAYWRIGHT_GREP"}

echo "CRITICAL WORKFLOW HARNESS PASS"