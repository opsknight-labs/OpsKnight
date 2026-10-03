#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${REPO_ROOT}"

PID_FILE="/tmp/opsknight-demo-expire.pid"
DEMO_TTL="${DEMO_TTL:-3600}" # Default: 60 minutes (3600 seconds)

# Check if requested immediate termination
if [ "${1:-}" = "--now" ] || [ "${1:-}" = "-f" ]; then
  DEMO_TTL=0
fi

# If PID file exists and points to a running process, kill previous watchdog
if [ -f "${PID_FILE}" ]; then
  OLD_PID="$(cat "${PID_FILE}" 2>/dev/null || true)"
  if [ -n "${OLD_PID}" ] && kill -0 "${OLD_PID}" 2>/dev/null && [ "${OLD_PID}" != "$$" ]; then
    kill "${OLD_PID}" 2>/dev/null || true
  fi
  rm -f "${PID_FILE}"
fi

echo "$$" > "${PID_FILE}"

if [ "${DEMO_TTL}" -gt 0 ]; then
  echo "⏱️  OpsKnight Demo TTL watchdog active: expiring in $(( DEMO_TTL / 60 )) minutes (${DEMO_TTL}s)..."
  sleep "${DEMO_TTL}"
fi

echo ""
echo "🛑 Demo TTL expired. Tearing down demo stack and wiping ephemeral volumes..."

# Destroy containers and ephemeral volumes
if [ -f "${SCRIPT_DIR}/docker-compose.yml" ]; then
  ENV_FILE="${SCRIPT_DIR}/.env"
  if [ -f "${ENV_FILE}" ]; then
    docker compose -p opsknight-demo -f "${SCRIPT_DIR}/docker-compose.yml" --env-file "${ENV_FILE}" down -v --remove-orphans 2>/dev/null || true
  else
    docker compose -p opsknight-demo -f "${SCRIPT_DIR}/docker-compose.yml" down -v --remove-orphans 2>/dev/null || true
  fi
fi

# Clean up .env
rm -f "${SCRIPT_DIR}/.env"
rm -f "${PID_FILE}"

# Write expiration marker
cat > "${REPO_ROOT}/.demo-expired" <<EOF
OpsKnight Demo session has completed and the ephemeral stack was destroyed.
Expiration timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")

To start a new demo session anytime, run:
  bash deploy/demo/start-demo.sh
EOF

echo "🧹 Ephemeral demo data destroyed."
echo "📝 Expiration notice saved to .demo-expired"

# Attempt to stop Codespace to preserve user compute quotas if gh CLI is available
if command -v gh >/dev/null 2>&1 && [ -n "${CODESPACE_NAME:-}" ]; then
  echo "💤 Stopping idle Codespace (${CODESPACE_NAME}) to conserve quota..."
  gh codespace stop -c "${CODESPACE_NAME}" 2>/dev/null || true
fi
