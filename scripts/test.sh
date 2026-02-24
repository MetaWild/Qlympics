#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ROOT_DIR/.env"
  set +a
fi

if [[ "${SKIP_E2E:-}" == "1" ]]; then
  if [[ "${SKIP_SETUP:-}" != "1" ]]; then
    make setup
  fi
  echo "Skipping end-to-end test (SKIP_E2E=1)"
  echo "Running db-verify..."
  make db-verify api-test game-test
  exit 0
fi

if [[ -z "${QUAI_TREASURY_PRIVATE_KEY:-}" ]]; then
  # Scale scenario can run in dry-run mode without a treasury key.
  if [[ "${E2E_SCENARIO:-}" == "scale" && "${E2E_SCALE_EXECUTE_PAYOUTS:-0}" != "1" ]]; then
    echo "QUAI_TREASURY_PRIVATE_KEY not set; running scale scenario in dry-run mode (no on-chain payouts)."
  else
    echo "QUAI_TREASURY_PRIVATE_KEY is required for full e2e test. Set SKIP_E2E=1 to skip." >&2
    exit 1
  fi
fi

if [[ "${SKIP_SETUP:-}" != "1" ]]; then
  make setup
fi

echo "Running db-verify..."
make db-verify api-test game-test

echo "Running end-to-end chain test..."
./scripts/e2e.sh
