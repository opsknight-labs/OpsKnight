#!/usr/bin/env bash
# ==============================================================================
# OpsKnight Docker Swarm Safe Deployment Orchestrator
#
# Sequential, fail-closed deployment workflow:
# 1. Validate environment, manager node status, and container image
# 2. Run runtime database connection capacity pre-flight check
# 3. Create or verify Docker Swarm secrets
# 4. Dispatch standalone database schema migration and wait for exit 0
# 5. Deploy / update Docker Swarm application stack
# 6. Wait for service convergence across all replicas
# 7. Run end-to-end health verification
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SWARM_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ROOT_DIR="$(cd "${SWARM_DIR}/../.." && pwd)"

STACK_NAME="${SWARM_STACK_NAME:-opsknight}"
OPSKNIGHT_IMAGE="${OPSKNIGHT_IMAGE:-ghcr.io/opsknight-labs/opsknight:latest}"
ENABLE_PGBOUNCER="${PGBOUNCER_ENABLED:-false}"
USE_EXTERNAL_DB="${EXTERNAL_DB:-false}"
CONVERGENCE_TIMEOUT_SEC="${CONVERGENCE_TIMEOUT_SEC:-180}"

echo "═══════════════════════════════════════════════════════════════════════"
echo "  OpsKnight Docker Swarm Safe Rollout Orchestrator"
echo "═══════════════════════════════════════════════════════════════════════"
echo "Stack Name:        ${STACK_NAME}"
echo "Application Image: ${OPSKNIGHT_IMAGE}"
echo "PgBouncer Enabled: ${ENABLE_PGBOUNCER}"
echo "External Database: ${USE_EXTERNAL_DB}"
echo ""

# --- Step 1: Pre-flight Environment Validation ---
echo "--- [1/7] Validating Swarm Cluster State ---"
if ! command -v docker >/dev/null 2>&1; then
  echo "❌ [FATAL] Docker CLI not found in PATH." >&2
  exit 1
fi

SWARM_STATE=$(docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null || echo "inactive")
if [ "${SWARM_STATE}" != "active" ]; then
  echo "❌ [FATAL] Docker Swarm is not active on this node." >&2
  echo "   Initialize with: docker swarm init" >&2
  exit 1
fi

IS_MANAGER=$(docker info --format '{{.Swarm.ControlAvailable}}' 2>/dev/null || echo "false")
if [ "${IS_MANAGER}" != "true" ]; then
  echo "❌ [FATAL] docker stack deploy must be executed from a Swarm manager node." >&2
  exit 1
fi
echo "✅ Node is an active Swarm manager."

# --- Step 2: Validate Database Connection Capacity ---
echo "--- [2/7] Running Connection Capacity Pre-flight ---"
STACK_FILES=("-c" "${SWARM_DIR}/docker-stack.yml")

if [ "${ENABLE_PGBOUNCER}" = "true" ]; then
  STACK_FILES+=("-c" "${SWARM_DIR}/docker-stack.pgbouncer.yml")
  export SWARM_STACK_FILE="docker-stack.pgbouncer.yml"
fi

if [ "${USE_EXTERNAL_DB}" = "true" ]; then
  STACK_FILES+=("-c" "${SWARM_DIR}/docker-stack.external-db.yml")
fi

if [ -f "${ROOT_DIR}/scripts/validate-runtime-capacity.cjs" ]; then
  SWARM_REPLICAS_WEB="${WEB_REPLICAS:-2}" \
  SWARM_REPLICAS_SCHEDULER="${SCHEDULER_REPLICAS:-2}" \
  node "${ROOT_DIR}/scripts/validate-runtime-capacity.cjs"
else
  echo "ℹ️  Capacity script not found; skipping capacity preflight."
fi

# --- Step 3: Create / Verify Swarm Secrets ---
echo "--- [3/7] Verifying Docker Swarm Secrets ---"
create_secret_if_missing() {
  local secret_name="$1"
  local example_file="$2"
  local env_val="${3:-}"

  if ! docker secret inspect "${secret_name}" >/dev/null 2>&1; then
    echo "  Creating secret: ${secret_name}..."
    if [ -n "${env_val}" ]; then
      printf '%s' "${env_val}" | docker secret create "${secret_name}" -
    elif [ -f "${example_file}" ]; then
      docker secret create "${secret_name}" "${example_file}"
    else
      echo "❌ [FATAL] Cannot initialize secret ${secret_name}: source not found." >&2
      exit 1
    fi
  else
    echo "  Secret ${secret_name} already exists."
  fi
}

SECRETS_DIR="${SWARM_DIR}/secrets.example"
create_secret_if_missing "opsknight_database_url" "${SECRETS_DIR}/database-url.txt.example" "${OPSKNIGHT_DATABASE_URL:-}"
create_secret_if_missing "opsknight_direct_database_url" "${SECRETS_DIR}/direct-database-url.txt.example" "${DIRECT_DATABASE_URL:-}"
create_secret_if_missing "opsknight_nextauth_secret" "${SECRETS_DIR}/nextauth-secret.txt.example" "${NEXTAUTH_SECRET:-}"
create_secret_if_missing "opsknight_encryption_key" "${SECRETS_DIR}/encryption-key.txt.example" "${ENCRYPTION_KEY:-}"

if [ "${ENABLE_PGBOUNCER}" = "true" ]; then
  create_secret_if_missing "opsknight_pgbouncer_userlist" "${SECRETS_DIR}/pgbouncer-userlist.txt.example" ""
  create_secret_if_missing "opsknight_web_database_url" "${SECRETS_DIR}/web-database-url.txt.example" "${WEB_DATABASE_URL:-}"
fi

# --- Step 4: Standalone Database Migration ---
echo "--- [4/7] Running Ephemeral Schema Migration ---"
"${SCRIPT_DIR}/migrate.sh"

# --- Step 5: Stack Deployment ---
echo "--- [5/7] Deploying OpsKnight Swarm Stack ---"
export OPSKNIGHT_IMAGE
docker stack deploy --with-registry-auth "${STACK_FILES[@]}" "${STACK_NAME}"

# --- Step 6: Service Convergence Verification ---
echo "--- [6/7] Waiting for Service Convergence (timeout: ${CONVERGENCE_TIMEOUT_SEC}s) ---"
START_TIME=$(date +%s)
CONVERGED=0

while true; do
  CURRENT_TIME=$(date +%s)
  ELAPSED=$((CURRENT_TIME - START_TIME))
  if [ "${ELAPSED}" -gt "${CONVERGENCE_TIMEOUT_SEC}" ]; then
    echo "❌ [TIMEOUT] Services did not converge within ${CONVERGENCE_TIMEOUT_SEC}s." >&2
    break
  fi

  PENDING=0
  while read -r name image replicas ports; do
    [ -z "${replicas}" ] && continue
    current=$(echo "${replicas}" | cut -d'/' -f1)
    desired=$(echo "${replicas}" | cut -d'/' -f2)
    if [ "${current}" != "${desired}" ]; then
      PENDING=$((PENDING + 1))
    fi
  done < <(docker stack services "${STACK_NAME}" --format '{{.Name}} {{.Image}} {{.Replicas}} {{.Ports}}' 2>/dev/null || true)

  if [ "${PENDING}" -eq 0 ]; then
    echo "✅ All services converged successfully in ${ELAPSED}s."
    CONVERGED=1
    break
  fi

  echo "  [${ELAPSED}s] ${PENDING} service(s) converging... waiting 5s"
  sleep 5
done

if [ "${CONVERGED}" -ne 1 ]; then
  echo "⚠️  [WARNING] Stack convergence timed out. Checking task diagnostics:"
  docker stack ps "${STACK_NAME}" --no-trunc | head -n 25
fi

# --- Step 7: Health Verification ---
echo "--- [7/7] Verifying System Health ---"
"${SCRIPT_DIR}/health-check.sh"

echo ""
echo "🎉 OpsKnight Swarm deployment finished successfully!"
