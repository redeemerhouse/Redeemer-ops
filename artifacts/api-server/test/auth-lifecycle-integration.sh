#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" || -z "${SESSION_SECRET:-}" ]]; then
  echo "DATABASE_URL and SESSION_SECRET are required" >&2
  exit 1
fi

DB_NAME="auth_lifecycle_validation_$$"
LEGACY_DB_NAME="auth_legacy_migration_validation_$$"
ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
PORT_NUMBER=5098
BASE_URL="http://127.0.0.1:${PORT_NUMBER}/api"
ORIGIN="https://pilot.redeemer.invalid"
ADMIN_EMAIL="initial-owner@redeemer.invalid"
TARGET_EMAIL="lifecycle-user@redeemer.invalid"
PASSWORD="ValidPassword123"
NEW_PASSWORD="UpdatedPassword456"
SERVER_PID=""
TEMP_DIR="$(mktemp -d)"

cleanup() {
  local status=$?
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  dropdb --maintenance-db="$DATABASE_URL" --if-exists "$DB_NAME" >/dev/null 2>&1 || true
  dropdb --maintenance-db="$DATABASE_URL" --if-exists "$LEGACY_DB_NAME" >/dev/null 2>&1 || true
  if [[ $status -eq 0 ]]; then
    rm -rf "$TEMP_DIR"
  else
    echo "Auth lifecycle diagnostics retained at $TEMP_DIR" >&2
  fi
}
trap cleanup EXIT
trap 'echo "auth lifecycle failed at line $LINENO" >&2' ERR

createdb --maintenance-db="$DATABASE_URL" "$LEGACY_DB_NAME"
LEGACY_DATABASE_URL="$(
  node -e 'const url = new URL(process.env.DATABASE_URL); url.pathname = `/${process.argv[1]}`; console.log(url.toString())' "$LEGACY_DB_NAME"
)"
for migration in "$ROOT_DIR"/lib/db/drizzle/000[0-8]_*.sql; do
  psql "$LEGACY_DATABASE_URL" -v ON_ERROR_STOP=1 -qf "$migration"
done
psql "$LEGACY_DATABASE_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
INSERT INTO houses(name, address, manager_name, family_capacity)
VALUES ('Legacy Test House', '1 Migration Way', 'Legacy Manager', 1);
INSERT INTO auth_accounts(email, password_hash, role, email_verified_at, approved_at, deactivated_at)
VALUES
  ('legacy-active@redeemer.invalid', 'not-used', 'program_director', now(), now(), null),
  ('legacy-disabled@redeemer.invalid', 'not-used', 'program_director', now(), now(), now()),
  ('legacy-never-approved@redeemer.invalid', 'not-used', 'resident', now(), null, now());
INSERT INTO auth_account_houses(account_id, house_id)
SELECT account.id, house.id
FROM auth_accounts account CROSS JOIN houses house
WHERE account.email = 'legacy-never-approved@redeemer.invalid'
  AND house.name = 'Legacy Test House';
SQL
psql "$LEGACY_DATABASE_URL" -v ON_ERROR_STOP=1 -qf "$ROOT_DIR/lib/db/drizzle/0009_aromatic_onslaught.sql"
[[ "$(psql "$LEGACY_DATABASE_URL" -qAtc "select account_status || ':' || role from auth_accounts where email='legacy-active@redeemer.invalid';")" == "active:program_director" ]]
[[ "$(psql "$LEGACY_DATABASE_URL" -qAtc "select account_status || ':' || role from auth_accounts where email='legacy-disabled@redeemer.invalid';")" == "disabled:program_director" ]]
[[ "$(psql "$LEGACY_DATABASE_URL" -qAtc "select account_status || ':' || coalesce(role, 'unassigned') from auth_accounts where email='legacy-never-approved@redeemer.invalid';")" == "pending:unassigned" ]]
[[ "$(psql "$LEGACY_DATABASE_URL" -qAtc "select count(*) from auth_account_houses houses join auth_accounts account on account.id=houses.account_id where account.email='legacy-never-approved@redeemer.invalid';")" == "0" ]]
dropdb --maintenance-db="$DATABASE_URL" "$LEGACY_DB_NAME"

createdb --maintenance-db="$DATABASE_URL" "$DB_NAME"
TEMP_DATABASE_URL="$(
  node -e 'const url = new URL(process.env.DATABASE_URL); url.pathname = `/${process.argv[1]}`; console.log(url.toString())' "$DB_NAME"
)"

DATABASE_URL="$TEMP_DATABASE_URL" pnpm --filter @workspace/db run migrate >"$TEMP_DIR/migrate.log"
DATABASE_URL="$TEMP_DATABASE_URL" PORT="$PORT_NUMBER" NODE_ENV=production \
  CORS_ORIGINS="$ORIGIN" API_RATE_LIMIT_STORE=postgres API_MUTATION_RATE_LIMIT=200 TRUST_PROXY=false DB_SSL=true \
  node "$ROOT_DIR/artifacts/api-server/dist/index.mjs" >"$TEMP_DIR/server.log" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 40); do
  if curl -fsS "$BASE_URL/healthz" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done
curl -fsS "$BASE_URL/healthz" >/dev/null

status="$(
  curl -sS -o "$TEMP_DIR/bootstrap.json" -w '%{http_code}' \
    -H "x-initial-admin-token: $SESSION_SECRET" \
    -H 'content-type: application/json' \
    -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$PASSWORD\"}" \
    "$BASE_URL/auth/bootstrap"
)"
[[ "$status" == "201" ]]

status="$(
  curl -sS -o "$TEMP_DIR/bootstrap-repeat.json" -w '%{http_code}' \
    -H "x-initial-admin-token: $SESSION_SECRET" \
    -H 'content-type: application/json' \
    -d "{\"email\":\"other-owner@redeemer.invalid\",\"password\":\"$PASSWORD\"}" \
    "$BASE_URL/auth/bootstrap"
)"
[[ "$status" == "409" ]]

login() {
  local email="$1"
  local password="$2"
  local prefix="$3"
  local status
  status="$(
    curl -sS -D "$TEMP_DIR/${prefix}-headers.txt" -o "$TEMP_DIR/${prefix}.json" -w '%{http_code}' \
      -H 'content-type: application/json' \
      -H "origin: $ORIGIN" -H 'x-forwarded-proto: https' -H 'x-forwarded-host: pilot.redeemer.invalid' \
      -d "{\"email\":\"$email\",\"password\":\"$password\"}" \
      "$BASE_URL/auth/login"
  )"
  [[ "$status" == "200" ]]
  grep -q '"expiresAt":"' "$TEMP_DIR/${prefix}.json"
  sed -n 's/^set-cookie: \([^;]*\).*/\1/ip' "$TEMP_DIR/${prefix}-headers.txt" | head -n 1
}

ADMIN_COOKIE="$(login "$ADMIN_EMAIL" "$PASSWORD" admin-login)"
[[ "$ADMIN_COOKIE" == __Host-recovery-session=* ]]
grep -qi '^set-cookie: __Host-recovery-session=' "$TEMP_DIR/admin-login-headers.txt"
grep -qi '^set-cookie: .*; Secure;' "$TEMP_DIR/admin-login-headers.txt"
grep -qi '^set-cookie: .*; HttpOnly;' "$TEMP_DIR/admin-login-headers.txt"
grep -qi '^set-cookie: .*; SameSite=Lax' "$TEMP_DIR/admin-login-headers.txt"
curl -fsS -o "$TEMP_DIR/admin-session.json" \
  -H "cookie: $ADMIN_COOKIE" "$BASE_URL/auth/session"
node - "$TEMP_DIR/admin-login.json" "$TEMP_DIR/admin-session.json" <<'NODE'
const fs = require("node:fs");
const login = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const session = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
if (typeof login.user?.id !== "string") throw new Error("login user id must be a string");
if (session.authenticated !== true) throw new Error("session bootstrap must confirm authentication");
if (session.user?.id !== login.user.id) throw new Error("login and session user ids must match");
if (!Number.isFinite(Date.parse(session.expiresAt))) throw new Error("session expiry must be an ISO timestamp");
NODE

status="$(
  curl -sS -o "$TEMP_DIR/register.json" -w '%{http_code}' \
    -H 'content-type: application/json' \
    -d "{\"firstName\":\"Lifecycle\",\"lastName\":\"User\",\"email\":\"$TARGET_EMAIL\",\"password\":\"$PASSWORD\",\"passwordConfirmation\":\"$PASSWORD\",\"role\":\"owner_admin\",\"status\":\"active\",\"organizationId\":\"attacker-org\",\"residentId\":1,\"houseIds\":[1]}" \
    "$BASE_URL/auth/register"
)"
[[ "$status" == "202" ]]
TARGET_ID="$(
  psql "$TEMP_DATABASE_URL" -qAtc \
    "select id from auth_accounts where email='$TARGET_EMAIL' and first_name='Lifecycle' and last_name='User' and account_status='pending' and role is null and resident_id is null;"
)"
[[ "$TARGET_ID" =~ ^[0-9]+$ ]]
status="$(
  curl -sS -o "$TEMP_DIR/register-duplicate.json" -w '%{http_code}' \
    -H 'content-type: application/json' \
    -d "{\"firstName\":\"Lifecycle\",\"lastName\":\"Duplicate\",\"email\":\"$TARGET_EMAIL\",\"password\":\"$PASSWORD\",\"passwordConfirmation\":\"$PASSWORD\"}" \
    "$BASE_URL/auth/register"
)"
[[ "$status" == "409" ]]
grep -q 'already exists' "$TEMP_DIR/register-duplicate.json"
status="$(
  curl -sS -o "$TEMP_DIR/register-invalid.json" -w '%{http_code}' \
    -H 'content-type: application/json' \
    -d "{\"firstName\":\"Lifecycle\",\"lastName\":\"Invalid\",\"email\":\"invalid@redeemer.invalid\",\"password\":\"$PASSWORD\",\"passwordConfirmation\":\"MismatchPassword123\"}" \
    "$BASE_URL/auth/register"
)"
[[ "$status" == "400" ]]
psql "$TEMP_DATABASE_URL" -qAtc \
  "update auth_accounts set email_verified_at=now() where id=$TARGET_ID;" >/dev/null

assert_revoked() {
  local cookie="$1"
  local status
  status="$(curl -sS -o /dev/null -w '%{http_code}' -H "cookie: $cookie" "$BASE_URL/auth/session")"
  [[ "$status" == "401" ]]
}

PENDING_COOKIE="$(login "$TARGET_EMAIL" "$PASSWORD" target-pending-login)"
node - "$TEMP_DIR/target-pending-login.json" <<'NODE'
const fs = require("node:fs");
const login = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (login.user?.accountStatus !== "pending") throw new Error("verified registrations must remain pending");
if (login.user?.role !== null) throw new Error("pending sessions must remain unassigned");
if (login.user?.residentId !== undefined || login.user?.houseNames?.length !== 0) throw new Error("pending sessions must not expose scope");
NODE
status="$(curl -sS -o /dev/null -w '%{http_code}' -H "cookie: $PENDING_COOKIE" "$BASE_URL/dashboard")"
[[ "$status" == "403" ]]
status="$(curl -sS -o /dev/null -w '%{http_code}' -H "cookie: $PENDING_COOKIE" "$BASE_URL/auth/admin/accounts")"
[[ "$status" == "403" ]]
status="$(
  curl -sS -o /dev/null -w '%{http_code}' -X POST \
    -H "cookie: $ADMIN_COOKIE" -H "origin: $ORIGIN" \
    "$BASE_URL/auth/admin/accounts/$TARGET_ID/restore"
)"
[[ "$status" == "400" ]]
[[ "$(psql "$TEMP_DATABASE_URL" -qAtc "select account_status || ':' || coalesce(role, 'unassigned') from auth_accounts where id=$TARGET_ID;")" == "pending:unassigned" ]]

status="$(
  curl -sS -o "$TEMP_DIR/activate.json" -w '%{http_code}' -X PATCH \
    -H "cookie: $ADMIN_COOKIE" -H "origin: $ORIGIN" -H 'content-type: application/json' \
    -d '{"role":"program_director","status":"active","houseIds":[],"residentId":null}' \
    "$BASE_URL/auth/admin/accounts/$TARGET_ID"
)"
[[ "$status" == "200" ]]
assert_revoked "$PENDING_COOKIE"
TARGET_COOKIE="$(login "$TARGET_EMAIL" "$PASSWORD" target-active-login)"
grep -q '"accountStatus":"active"' "$TEMP_DIR/target-active-login.json"

status="$(
  curl -sS -o /dev/null -w '%{http_code}' \
    -H 'content-type: application/json' \
    -d "{\"firstName\":\"Promotion\",\"lastName\":\"Target\",\"email\":\"promotion-target@redeemer.invalid\",\"password\":\"$PASSWORD\",\"passwordConfirmation\":\"$PASSWORD\"}" \
    "$BASE_URL/auth/register"
)"
[[ "$status" == "202" ]]
PROMOTION_TARGET_ID="$(
  psql "$TEMP_DATABASE_URL" -qAtc \
    "update auth_accounts set email_verified_at=now() where email='promotion-target@redeemer.invalid' returning id;"
)"
[[ "$PROMOTION_TARGET_ID" =~ ^[0-9]+$ ]]
ADMIN_ID="$(psql "$TEMP_DATABASE_URL" -qAtc "select id from auth_accounts where email='$ADMIN_EMAIL';")"

status="$(
  curl -sS -o /dev/null -w '%{http_code}' -X POST \
    -H "cookie: $TARGET_COOKIE" -H "origin: $ORIGIN" -H 'content-type: application/json' \
    -d '{"role":"owner_admin","houseIds":[]}' \
    "$BASE_URL/auth/admin/accounts/$TARGET_ID/approve"
)"
[[ "$status" == "403" ]]
status="$(
  curl -sS -o /dev/null -w '%{http_code}' -X POST \
    -H "cookie: $TARGET_COOKIE" -H "origin: $ORIGIN" -H 'content-type: application/json' \
    -d '{"role":"owner_admin","houseIds":[]}' \
    "$BASE_URL/auth/admin/accounts/$PROMOTION_TARGET_ID/approve"
)"
[[ "$status" == "403" ]]
status="$(
  curl -sS -o /dev/null -w '%{http_code}' -X POST \
    -H "cookie: $TARGET_COOKIE" -H "origin: $ORIGIN" -H 'content-type: application/json' \
    -d '{"role":"program_director","houseIds":[]}' \
    "$BASE_URL/auth/admin/accounts/$TARGET_ID/approve"
)"
[[ "$status" == "403" ]]
status="$(
  curl -sS -o /dev/null -w '%{http_code}' -X POST \
    -H "cookie: $TARGET_COOKIE" -H "origin: $ORIGIN" \
    "$BASE_URL/auth/admin/accounts/$ADMIN_ID/deactivate"
)"
[[ "$status" == "403" ]]

status="$(
  curl -sS -o /dev/null -w '%{http_code}' -X POST \
    -H "cookie: $ADMIN_COOKIE" -H "origin: $ORIGIN" \
    "$BASE_URL/auth/admin/accounts/$TARGET_ID/sessions/revoke"
)"
[[ "$status" == "200" ]]
assert_revoked "$TARGET_COOKIE"

TARGET_COOKIE="$(login "$TARGET_EMAIL" "$PASSWORD" target-assignment-login)"
status="$(
  curl -sS -o /dev/null -w '%{http_code}' -X POST \
    -H "cookie: $ADMIN_COOKIE" -H "origin: $ORIGIN" -H 'content-type: application/json' \
    -d '{"role":"program_director","houseIds":[]}' \
    "$BASE_URL/auth/admin/accounts/$TARGET_ID/approve"
)"
[[ "$status" == "200" ]]
assert_revoked "$TARGET_COOKIE"

TARGET_COOKIE="$(login "$TARGET_EMAIL" "$PASSWORD" target-suspend-login)"
status="$(
  curl -sS -o /dev/null -w '%{http_code}' -X POST \
    -H "cookie: $ADMIN_COOKIE" -H "origin: $ORIGIN" \
    "$BASE_URL/auth/admin/accounts/$TARGET_ID/suspend"
)"
[[ "$status" == "200" ]]
assert_revoked "$TARGET_COOKIE"
status="$(
  curl -sS -o "$TEMP_DIR/suspended-login.json" -w '%{http_code}' \
    -H 'content-type: application/json' \
    -d "{\"email\":\"$TARGET_EMAIL\",\"password\":\"$PASSWORD\"}" \
    "$BASE_URL/auth/login"
)"
[[ "$status" == "403" ]]
grep -q 'suspended' "$TEMP_DIR/suspended-login.json"
status="$(
  curl -sS -o /dev/null -w '%{http_code}' -X POST \
    -H "cookie: $ADMIN_COOKIE" -H "origin: $ORIGIN" \
    "$BASE_URL/auth/admin/accounts/$TARGET_ID/restore"
)"
[[ "$status" == "200" ]]

TARGET_COOKIE="$(login "$TARGET_EMAIL" "$PASSWORD" target-disable-login)"
status="$(
  curl -sS -o /dev/null -w '%{http_code}' -X POST \
    -H "cookie: $ADMIN_COOKIE" -H "origin: $ORIGIN" \
    "$BASE_URL/auth/admin/accounts/$TARGET_ID/deactivate"
)"
[[ "$status" == "200" ]]
assert_revoked "$TARGET_COOKIE"
status="$(
  curl -sS -o "$TEMP_DIR/disabled-login.json" -w '%{http_code}' \
    -H 'content-type: application/json' \
    -d "{\"email\":\"$TARGET_EMAIL\",\"password\":\"$PASSWORD\"}" \
    "$BASE_URL/auth/login"
)"
[[ "$status" == "403" ]]
grep -q 'disabled' "$TEMP_DIR/disabled-login.json"

status="$(
  curl -sS -o /dev/null -w '%{http_code}' -X POST \
    -H "cookie: $ADMIN_COOKIE" -H "origin: $ORIGIN" \
    "$BASE_URL/auth/admin/accounts/$TARGET_ID/reactivate"
)"
[[ "$status" == "200" ]]
TARGET_COOKIE="$(login "$TARGET_EMAIL" "$PASSWORD" target-reset-login)"

RESET_TOKEN="0123456789abcdef0123456789abcdef0123456789abcdef"
RESET_HASH="$(printf '%s' "$RESET_TOKEN" | sha256sum | cut -d' ' -f1)"
psql "$TEMP_DATABASE_URL" -qAtc \
  "insert into auth_action_tokens(account_id,token_hash,type,expires_at) values($TARGET_ID,'$RESET_HASH','password_reset',now()+interval '1 hour');" >/dev/null
status="$(
  curl -sS -o /dev/null -w '%{http_code}' \
    -H 'content-type: application/json' \
    -d "{\"token\":\"$RESET_TOKEN\",\"password\":\"$NEW_PASSWORD\"}" \
    "$BASE_URL/auth/password-reset/complete"
)"
[[ "$status" == "200" ]]
assert_revoked "$TARGET_COOKIE"
TARGET_COOKIE="$(login "$TARGET_EMAIL" "$NEW_PASSWORD" target-new-password-login)"
status="$(
  curl -sS -o /dev/null -w '%{http_code}' -X POST \
    -H "cookie: $TARGET_COOKIE" -H "origin: $ORIGIN" \
    -H 'x-forwarded-proto: https' -H 'x-forwarded-host: pilot.redeemer.invalid' \
    "$BASE_URL/auth/logout"
)"
[[ "$status" == "204" ]]
assert_revoked "$TARGET_COOKIE"

AUDIT_COUNT="$(psql "$TEMP_DATABASE_URL" -qAtc "select count(*) from audit_events where action='auth.account_access_changed' and entity_id=$TARGET_ID and actor='$ADMIN_ID' and metadata ? 'previous' and metadata ? 'new';")"
[[ "$AUDIT_COUNT" -ge 4 ]]

echo "auth lifecycle integration passed"