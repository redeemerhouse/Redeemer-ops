#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" || -z "${SESSION_SECRET:-}" ]]; then
  echo "DATABASE_URL and SESSION_SECRET are required" >&2
  exit 1
fi

DB_NAME="auth_lifecycle_validation_$$"
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
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  dropdb --maintenance-db="$DATABASE_URL" --if-exists "$DB_NAME" >/dev/null 2>&1 || true
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

createdb --maintenance-db="$DATABASE_URL" "$DB_NAME"
TEMP_DATABASE_URL="$(
  node -e 'const url = new URL(process.env.DATABASE_URL); url.pathname = `/${process.argv[1]}`; console.log(url.toString())' "$DB_NAME"
)"

DATABASE_URL="$TEMP_DATABASE_URL" pnpm --filter @workspace/db run migrate >"$TEMP_DIR/migrate.log"
DATABASE_URL="$TEMP_DATABASE_URL" PORT="$PORT_NUMBER" NODE_ENV=production \
  CORS_ORIGINS="$ORIGIN" API_RATE_LIMIT_STORE=postgres TRUST_PROXY=false DB_SSL=true \
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

curl -sS -o /dev/null \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$TARGET_EMAIL\",\"password\":\"$PASSWORD\"}" \
  "$BASE_URL/auth/register"
TARGET_ID="$(
  psql "$TEMP_DATABASE_URL" -qAtc \
    "update auth_accounts set email_verified_at=now(), approved_at=now(), role='program_director' where email='$TARGET_EMAIL' returning id;"
)"
[[ "$TARGET_ID" =~ ^[0-9]+$ ]]

assert_revoked() {
  local cookie="$1"
  local status
  status="$(curl -sS -o /dev/null -w '%{http_code}' -H "cookie: $cookie" "$BASE_URL/auth/session")"
  [[ "$status" == "401" ]]
}

TARGET_COOKIE="$(login "$TARGET_EMAIL" "$PASSWORD" target-revoke-login)"

curl -sS -o /dev/null \
  -H 'content-type: application/json' \
  -d "{\"email\":\"promotion-target@redeemer.invalid\",\"password\":\"$PASSWORD\"}" \
  "$BASE_URL/auth/register"
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

TARGET_COOKIE="$(login "$TARGET_EMAIL" "$PASSWORD" target-deactivate-login)"
status="$(
  curl -sS -o /dev/null -w '%{http_code}' -X POST \
    -H "cookie: $ADMIN_COOKIE" -H "origin: $ORIGIN" \
    "$BASE_URL/auth/admin/accounts/$TARGET_ID/deactivate"
)"
[[ "$status" == "200" ]]
assert_revoked "$TARGET_COOKIE"

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

echo "auth lifecycle integration passed"