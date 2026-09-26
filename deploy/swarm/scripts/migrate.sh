#!/usr/bin/env bash
# ==============================================================================
# OpsKnight Docker Swarm Migration Runner
#
# Executes database schema migrations and online index creation as a standalone,
# ephemeral Swarm service before application service rollout.
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../../.." && pwd)"

SERVICE_NAME="${MIGRATION_SERVICE_NAME:-opsknight_migration_task}"
NETWORK_NAME="${SWARM_NETWORK_NAME:-opsknight}"
OPSKNIGHT_IMAGE="${OPSKNIGHT_IMAGE:-ghcr.io/opsknight-labs/opsknight:latest}"
TIMEOUT_SEC="${MIGRATION_TIMEOUT_SEC:-300}"

echo "═══════════════════════════════════════════════════════════════════════"
echo "  OpsKnight Swarm Database Migration"
echo "═══════════════════════════════════════════════════════════════════════"
echo "Target Image:    ${OPSKNIGHT_IMAGE}"
echo "Overlay Network: ${NETWORK_NAME}"
echo "Timeout:         ${TIMEOUT_SEC}s"
echo ""

# 1. Verify Swarm is active
if ! docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null | grep -q 'active'; then
  echo "❌ [ERROR] Docker Swarm is not active on this host." >&2
  exit 1
fi

# 2. Ensure overlay network exists
if ! docker network inspect "${NETWORK_NAME}" >/dev/null 2>&1; then
  echo "🌐 Creating attachable overlay network '${NETWORK_NAME}'..."
  docker network create --driver overlay --attachable "${NETWORK_NAME}"
fi

# 3. Clean up any previous migration task
docker service rm "${SERVICE_NAME}" >/dev/null 2>&1 || true

# Build secret options if secrets exist
SECRET_ARGS=()
for secret_name in opsknight_direct_database_url opsknight_database_url opsknight_nextauth_secret opsknight_encryption_key; do
  if docker secret inspect "${secret_name}" >/dev/null 2>&1; then
    SECRET_ARGS+=(--secret "${secret_name}")
  fi
done

# Build environment arguments
ENV_ARGS=(
  --env NODE_ENV=production
  --env OPSKNIGHT_MIGRATION_ONLY=true
  --env NEXTAUTH_URL="${NEXTAUTH_URL:-http://localhost:3000}"
  --env NEXT_PUBLIC_APP_URL="${NEXT_PUBLIC_APP_URL:-http://localhost:3000}"
)

if docker secret inspect opsknight_direct_database_url >/dev/null 2>&1; then
  ENV_ARGS+=(--env DIRECT_DATABASE_URL_FILE=/run/secrets/opsknight_direct_database_url)
  ENV_ARGS+=(--env DATABASE_URL_FILE=/run/secrets/opsknight_direct_database_url)
elif [ -n "${DIRECT_DATABASE_URL:-}" ]; then
  ENV_ARGS+=(--env DIRECT_DATABASE_URL="${DIRECT_DATABASE_URL}")
  ENV_ARGS+=(--env DATABASE_URL="${DIRECT_DATABASE_URL}")
elif [ -n "${OPSKNIGHT_DATABASE_URL:-}" ]; then
  ENV_ARGS+=(--env DIRECT_DATABASE_URL="${OPSKNIGHT_DATABASE_URL}")
  ENV_ARGS+=(--env DATABASE_URL="${OPSKNIGHT_DATABASE_URL}")
fi

if docker secret inspect opsknight_nextauth_secret >/dev/null 2>&1; then
  ENV_ARGS+=(--env NEXTAUTH_SECRET_FILE=/run/secrets/opsknight_nextauth_secret)
elif [ -n "${NEXTAUTH_SECRET:-}" ]; then
  ENV_ARGS+=(--env NEXTAUTH_SECRET="${NEXTAUTH_SECRET}")
fi

if docker secret inspect opsknight_encryption_key >/dev/null 2>&1; then
  ENV_ARGS+=(--env ENCRYPTION_KEY_FILE=/run/secrets/opsknight_encryption_key)
elif [ -n "${ENCRYPTION_KEY:-}" ]; then
  ENV_ARGS+=(--env ENCRYPTION_KEY="${ENCRYPTION_KEY}")
fi

echo "🚀 Dispatching migration service task '${SERVICE_NAME}'..."
docker service create \
  --name "${SERVICE_NAME}" \
  --network "${NETWORK_NAME}" \
  --restart-condition none \
  "${SECRET_ARGS[@]}" \
  "${ENV_ARGS[@]}" \
  "${OPSKNIGHT_IMAGE}" >/dev/null

echo "⏳ Waiting for database migration task to complete (timeout: ${TIMEOUT_SEC}s)..."
START_TIME=$(date +%s)
TASK_COMPLETED=0
EXIT_CODE=1

while true; do
  CURRENT_TIME=$(date +%s)
  ELAPSED=$((CURRENT_TIME - START_TIME))
  if [ "${ELAPSED}" -gt "${TIMEOUT_SEC}" ]; then
    echo "❌ [TIMEOUT] Migration task exceeded ${TIMEOUT_SEC}s limit." >&2
    break
  fi

  # Get the latest task state
  TASK_LINE=$(docker service ps "${SERVICE_NAME}" --no-trunc --format '{{.CurrentState}}' 2>/dev/null | head -n 1 || true)

  if echo "${TASK_LINE}" | grep -q -iE '^Complete'; then
    echo "✅ Migration task completed successfully in ${ELAPSED}s."
    TASK_COMPLETED=1
    EXIT_CODE=0
    break
  elif echo "${TASK_LINE}" | grep -q -iE '^Failed|^Rejected'; then
    echo "❌ Migration task failed with state: ${TASK_LINE}" >&2
    echo "--- Task Logs ---"
    docker service logs "${SERVICE_NAME}" 2>&1 | tail -n 50 || true
    echo "-----------------"
    EXIT_CODE=1
    break
  fi

  sleep 2
done

# Cleanup temporary service
echo "🧹 Cleaning up migration service..."
docker service rm "${SERVICE_NAME}" >/dev/null 2>&1 || true

if [ "${TASK_COMPLETED}" -eq 1 ] && [ "${EXIT_CODE}" -eq 0 ]; then
  echo "🎉 Schema migrations verified. Safe to proceed with application stack deployment."
  exit 0
else
  echo "💥 [FATAL] Database migrations failed. Aborting stack deployment to preserve schema integrity." >&2
  exit 1
fi
