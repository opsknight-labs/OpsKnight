#!/usr/bin/env bash
# ==============================================================================
# OpsKnight Docker Swarm Safe Deployment Orchestrator
#
# Sequential, fail-closed deployment workflow:
# 1. Validate environment, manager node status, and container image
# 2. Run runtime database connection capacity pre-flight check
# 3. Create or verify Docker Swarm external overlay network and secrets
# 4. Bootstrap / ensure PostgreSQL service readiness (if bundled DB is used)
# 5. Dispatch standalone database schema migration and wait for exit 0
# 6. Deploy / update Docker Swarm application stack (split or integrated)
# 7. Wait for service convergence across all replicas (fails closed on timeout)
# 8. Run end-to-end health verification (fails closed on degraded service)
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SWARM_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ROOT_DIR="$(cd "${SWARM_DIR}/../.." && pwd)"

STACK_NAME="${SWARM_STACK_NAME:-opsknight}"
NETWORK_NAME="${SWARM_NETWORK_NAME:-opsknight}"
OPSKNIGHT_IMAGE="${OPSKNIGHT_IMAGE:-ghcr.io/opsknight-labs/opsknight:latest}"
SWARM_RUNTIME_MODE="${SWARM_RUNTIME_MODE:-split}"
ENABLE_PGBOUNCER="${PGBOUNCER_ENABLED:-false}"
USE_EXTERNAL_DB="${EXTERNAL_DB:-false}"
STRICT_SECRETS="${STRICT_SECRETS:-false}"
ENVIRONMENT="${ENVIRONMENT:-${NODE_ENV:-development}}"
CONVERGENCE_TIMEOUT_SEC="${CONVERGENCE_TIMEOUT_SEC:-180}"
DB_READY_TIMEOUT_SEC="${DB_READY_TIMEOUT_SEC:-60}"

echo "═══════════════════════════════════════════════════════════════════════"
echo "  OpsKnight Docker Swarm Safe Rollout Orchestrator"
echo "═══════════════════════════════════════════════════════════════════════"
echo "Stack Name:        ${STACK_NAME}"
echo "Overlay Network:   ${NETWORK_NAME}"
echo "Runtime Mode:      ${SWARM_RUNTIME_MODE}"
echo "Application Image: ${OPSKNIGHT_IMAGE}"
echo "PgBouncer Enabled: ${ENABLE_PGBOUNCER}"
echo "External Database: ${USE_EXTERNAL_DB}"
echo "Environment:       ${ENVIRONMENT}"
echo ""

# --- Step 1: Pre-flight Environment Validation ---
echo "--- [1/8] Validating Swarm Cluster State ---"
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
echo "--- [2/8] Running Connection Capacity Pre-flight ---"
if [ "${SWARM_RUNTIME_MODE}" = "split" ]; then
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
  fi
elif [ "${SWARM_RUNTIME_MODE}" = "integrated" ]; then
  STACK_FILES=("-c" "${SWARM_DIR}/docker-stack.integrated.yml")
  if [ -f "${ROOT_DIR}/scripts/validate-runtime-capacity.cjs" ]; then
    OPSKNIGHT_RUNTIME_MODE="integrated" \
    SWARM_REPLICAS_INTEGRATED="${INTEGRATED_REPLICAS:-1}" \
    node "${ROOT_DIR}/scripts/validate-runtime-capacity.cjs"
  fi
else
  echo "❌ [FATAL] Unknown SWARM_RUNTIME_MODE: '${SWARM_RUNTIME_MODE}'. Must be 'split' or 'integrated'." >&2
  exit 1
fi

# --- Step 3: Create External Overlay Network & Verify Secrets ---
echo "--- [3/8] Ensuring Overlay Network & Raft Secrets ---"
if ! docker network inspect "${NETWORK_NAME}" >/dev/null 2>&1; then
  echo "  Creating external attachable overlay network: ${NETWORK_NAME}..."
  docker network create --driver overlay --attachable "${NETWORK_NAME}"
fi

# Resolve dynamic database URLs and credentials
DB_USER="${POSTGRES_USER:-opsknight}"
DB_PASS="${POSTGRES_PASSWORD:-opsknight_secure_password_change_me}"
DB_NAME="${POSTGRES_DB:-opsknight_db}"

if [ "${USE_EXTERNAL_DB}" = "true" ] || [ "${EXTERNAL_DB:-false}" = "true" ]; then
  DB_HOST="${EXTERNAL_DB_HOST:-${POSTGRES_HOST:-}}"
  DB_PORT="${EXTERNAL_DB_PORT:-${POSTGRES_PORT:-5432}}"
  DB_USER="${EXTERNAL_DB_USER:-${POSTGRES_USER:-opsknight}}"
  DB_PASS="${EXTERNAL_DB_PASSWORD:-${POSTGRES_PASSWORD:-}}"
  DB_NAME="${EXTERNAL_DB_NAME:-${POSTGRES_DB:-opsknight_db}}"

  if [ -z "${DB_HOST}" ]; then
    echo "❌ [FATAL] External database requested but EXTERNAL_DB_HOST is not set." >&2
    exit 1
  fi

  ENCODED_USER=$(node -e 'console.log(encodeURIComponent(process.argv[1]))' "$DB_USER")
  ENCODED_PASS=$(node -e 'console.log(encodeURIComponent(process.argv[1]))' "$DB_PASS")

  if [ -z "${DIRECT_DATABASE_URL:-}" ]; then
    export DIRECT_DATABASE_URL="postgresql://${ENCODED_USER}:${ENCODED_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}?sslmode=prefer&connection_limit=10&pool_timeout=30"
  fi
  if [ -z "${OPSKNIGHT_DATABASE_URL:-}" ]; then
    if [ "${ENABLE_PGBOUNCER}" = "true" ]; then
      export WEB_DATABASE_URL="postgresql://${ENCODED_USER}:${ENCODED_PASS}@opsknight-pgbouncer:6432/${DB_NAME}?sslmode=disable&pgbouncer=true"
      export OPSKNIGHT_DATABASE_URL="$WEB_DATABASE_URL"
    else
      export OPSKNIGHT_DATABASE_URL="postgresql://${ENCODED_USER}:${ENCODED_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}?sslmode=prefer&connection_limit=40&pool_timeout=30"
    fi
  fi
else
  # Bundled PostgreSQL
  ENCODED_USER=$(node -e 'console.log(encodeURIComponent(process.argv[1]))' "$DB_USER")
  ENCODED_PASS=$(node -e 'console.log(encodeURIComponent(process.argv[1]))' "$DB_PASS")

  if [ -z "${DIRECT_DATABASE_URL:-}" ]; then
    export DIRECT_DATABASE_URL="postgresql://${ENCODED_USER}:${ENCODED_PASS}@opsknight-db:5432/${DB_NAME}?sslmode=prefer&connection_limit=10&pool_timeout=30"
  fi
  if [ -z "${OPSKNIGHT_DATABASE_URL:-}" ]; then
    if [ "${ENABLE_PGBOUNCER}" = "true" ]; then
      export WEB_DATABASE_URL="postgresql://${ENCODED_USER}:${ENCODED_PASS}@opsknight-pgbouncer:6432/${DB_NAME}?sslmode=disable&pgbouncer=true"
      export OPSKNIGHT_DATABASE_URL="$WEB_DATABASE_URL"
    else
      export OPSKNIGHT_DATABASE_URL="postgresql://${ENCODED_USER}:${ENCODED_PASS}@opsknight-db:5432/${DB_NAME}?sslmode=prefer&connection_limit=40&pool_timeout=30"
    fi
  fi
fi

if [ "${ENABLE_PGBOUNCER}" = "true" ] && [ -z "${WEB_DATABASE_URL:-}" ]; then
  ENCODED_USER=$(node -e 'console.log(encodeURIComponent(process.argv[1]))' "$DB_USER")
  ENCODED_PASS=$(node -e 'console.log(encodeURIComponent(process.argv[1]))' "$DB_PASS")
  export WEB_DATABASE_URL="postgresql://${ENCODED_USER}:${ENCODED_PASS}@opsknight-pgbouncer:6432/${DB_NAME}?sslmode=disable&pgbouncer=true"
fi

PGBOUNCER_USERLIST_CONTENT=$(printf '"%s" "%s"\n' "${DB_USER}" "${DB_PASS}")

# Export credentials for child processes / stack environment
export POSTGRES_USER="${DB_USER}"
export POSTGRES_PASSWORD="${DB_PASS}"
export PGBOUNCER_DB_USER="${DB_USER}"
export PGBOUNCER_DB_PASSWORD="${DB_PASS}"

create_secret_if_missing() {
  local secret_name="$1"
  local example_file="$2"
  local env_val="${3:-}"

  if ! docker secret inspect "${secret_name}" >/dev/null 2>&1; then
    echo "  Creating secret: ${secret_name}..."
    if [ -n "${env_val}" ]; then
      printf '%s' "${env_val}" | docker secret create "${secret_name}" -
    elif [ -f "${example_file}" ]; then
      if [ "${STRICT_SECRETS}" = "true" ] || [ "${ENVIRONMENT}" = "production" ]; then
        echo "❌ [FATAL] STRICT_SECRETS enforced: Refusing to create ${secret_name} from placeholder ${example_file}." >&2
        exit 1
      fi
      echo "  ⚠️  [DEV WARNING] Populating secret ${secret_name} from example template: ${example_file}"
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
  create_secret_if_missing "opsknight_pgbouncer_userlist" "${SECRETS_DIR}/pgbouncer-userlist.txt.example" "${PGBOUNCER_USERLIST_CONTENT}"
  create_secret_if_missing "opsknight_web_database_url" "${SECRETS_DIR}/web-database-url.txt.example" "${WEB_DATABASE_URL:-}"
fi

# --- Step 4: Bootstrap / Ensure Database Readiness ---
echo "--- [4/8] Ensuring Database Service Readiness ---"
if [ "${USE_EXTERNAL_DB}" = "true" ]; then
  echo "ℹ️  Using external database; skipping bundled PostgreSQL startup."
else
  # Ensure storage node pinning label exists
  if ! docker node ls --filter "node.label=opsknight.database=true" -q | grep -q .; then
    CURRENT_NODE_ID=$(docker info --format '{{.Swarm.NodeID}}')
    echo "  Applying 'opsknight.database=true' label to current node: ${CURRENT_NODE_ID}..."
    docker node update --label-add opsknight.database=true "${CURRENT_NODE_ID}" >/dev/null
  fi

  echo "  Deploying bundled PostgreSQL service manifest..."
  docker stack deploy --with-registry-auth -c "${SWARM_DIR}/docker-stack.db.yml" "${STACK_NAME}"

  echo "⏳ Waiting for bundled PostgreSQL readiness (timeout: ${DB_READY_TIMEOUT_SEC}s)..."
  START_TIME=$(date +%s)
  DB_READY=0

  while true; do
    CURRENT_TIME=$(date +%s)
    ELAPSED=$((CURRENT_TIME - START_TIME))
    if [ "${ELAPSED}" -gt "${DB_READY_TIMEOUT_SEC}" ]; then
      echo "❌ [TIMEOUT] PostgreSQL service was not ready within ${DB_READY_TIMEOUT_SEC}s." >&2
      docker service logs "${STACK_NAME}_opsknight-db" 2>&1 | tail -n 25 || true
      exit 1
    fi

    # Check container health status via docker inspect on the task container
    TASK_CONTAINER=$(docker ps --filter "label=com.docker.swarm.service.name=${STACK_NAME}_opsknight-db" -q | head -n 1 || true)
    if [ -n "${TASK_CONTAINER}" ]; then
      HEALTH_STATUS=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}unknown{{end}}' "${TASK_CONTAINER}" 2>/dev/null || echo "unknown")
      if [ "${HEALTH_STATUS}" = "healthy" ]; then
        echo "✅ PostgreSQL is healthy and accepting connections (${ELAPSED}s)."
        DB_READY=1
        break
      fi
    fi
    sleep 2
  done
fi

# --- Step 5: Standalone Database Schema Migration ---
echo "--- [5/8] Running Ephemeral Schema Migration ---"
export OPSKNIGHT_IMAGE
"${SCRIPT_DIR}/migrate.sh"

# --- Step 6: Deploy Application Stack ---
echo "--- [6/8] Deploying OpsKnight Swarm Stack (${SWARM_RUNTIME_MODE} mode) ---"
docker stack deploy --with-registry-auth "${STACK_FILES[@]}" "${STACK_NAME}"

# --- Step 7: Service Convergence Verification ---
echo "--- [7/8] Waiting for Service Convergence (timeout: ${CONVERGENCE_TIMEOUT_SEC}s) ---"
START_TIME=$(date +%s)
CONVERGED=0

while true; do
  CURRENT_TIME=$(date +%s)
  ELAPSED=$((CURRENT_TIME - START_TIME))
  if [ "${ELAPSED}" -gt "${CONVERGENCE_TIMEOUT_SEC}" ]; then
    echo "💥 [FATAL] Stack convergence timed out after ${CONVERGENCE_TIMEOUT_SEC}s." >&2
    docker stack ps "${STACK_NAME}" --no-trunc | head -n 25 >&2
    exit 1
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

# --- Step 8: Health Verification ---
echo "--- [8/8] Verifying System Health ---"
"${SCRIPT_DIR}/health-check.sh"

echo ""
echo "🎉 OpsKnight Swarm deployment finished successfully!"
exit 0
