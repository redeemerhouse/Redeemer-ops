#!/usr/bin/env bash
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

failed=0
run_layer() {
  local label="$1"
  shift
  echo "=== ${label} ==="
  if "$@"; then
    echo "${label}: PASS"
  else
    echo "${label}: FAIL" >&2
    failed=1
  fi
}

run_layer "TYPECHECK" pnpm run typecheck
run_layer "UNIT" pnpm --filter @workspace/api-server run test:policy
run_layer "API RELIABILITY" pnpm --filter @workspace/api-server run test:reliability
run_layer "INTEGRATION + BROWSER E2E" pnpm --filter @workspace/api-server run test:critical-workflows

if [[ $failed -eq 0 ]]; then
  echo "DEPLOYMENT CHECK PASS"
  exit 0
fi

echo "DEPLOYMENT CHECK FAIL" >&2
exit 1