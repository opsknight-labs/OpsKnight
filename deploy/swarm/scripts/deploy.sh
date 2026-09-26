#!/usr/bin/env bash
# ==============================================================================
# OpsKnight Docker Swarm Safe Deployment Orchestrator
#
# Sequential, fail-closed deployment workflow:
# 1. Validate environment, manager node status, and cluster topology
# 2. Run runtime database connection capacity pre-flight check
# 3. Create or verify Docker Swarm overlay network and versioned Raft secrets
# 4. Bootstrap / ensure PostgreSQL service readiness (if bundled DB is used)
# 5. Dispatch standalone database schema migration with registry auth & exit 0 wait
# 6. Deploy / update Docker Swarm application stack with prune for clean mode switches
# 7. Wait for service convergence across all replicas (fails closed on timeout)
# 8. Run end-to-end health verification (fails closed on degraded service)
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SWARM_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ROOT_DIR="$(cd "${SWARM_DIR}/../.." && pwd)"

STACK_NAME="${SWARM_STACK_NAME:-opsknight}"
NETWORK_NAME="${SWARM_NETWORK_NAME:-${STACK_NAME}_network}"
OPSKNIGHT_IMAGE="${OPSKNIGHT_IMAGE:-ghcr.io/opsknight-labs/opsknight:latest}"
SWARM_RUNTIME_MODE="${SWARM_RUNTIME_MODE:-split}"
ENABLE_PGBOUNCER="${PGBOUNCER_ENABLED:-${ENABLE_PGBOUNCER:-false}}"
USE_EXTERNAL_DB="${EXTERNAL_DB:-${USE_EXTERNAL_DB:-false}}"
ENVIRONMENT="${ENVIRONMENT:-${NODE_ENV:-production}}"
ALLOW_INSECURE_SECRETS="${ALLOW_INSECURE_SECRETS:-false}"
AUTO_LABEL_DATABASE_NODE="${AUTO_LABEL_DATABASE_NODE:-false}"
CONVERGENCE_TIMEOUT_SEC="${CONVERGENCE_TIMEOUT_SEC:-180}"
DB_READY_TIMEOUT_SEC="${DB_READY_TIMEOUT_SEC:-60}"

if [ "${ENVIRONMENT}" = "production" ] && [ "${ALLOW_INSECURE_SECRETS}" != "true" ]; then
  STRICT_SECRETS="true"
else
  STRICT_SECRETS="${STRICT_SECRETS:-false}"
fi

# --- Early Resolution: Resolve Database URLs and Credentials ---
DB_USER="${POSTGRES_USER:-opsknight}"
DB_PASS="${POSTGRES_PASSWORD:-opsknight_secure_password_change_me}"
DB_NAME="${POSTGRES_DB:-opsknight_db}"
DB_HOST="opsknight-db"
DB_PORT="5432"

# Parse structured credentials from supplied database URLs if provided
if [ -n "${DIRECT_DATABASE_URL:-}" ] || [ -n "${OPSKNIGHT_DATABASE_URL:-}" ]; then
  SAMPLE_URL="${DIRECT_DATABASE_URL:-${OPSKNIGHT_DATABASE_URL}}"
  PARSED_CREDS=$(node -e '
    try {
      const u = new URL(process.argv[1]);
      const user = decodeURIComponent(u.username || "");
      const pass = decodeURIComponent(u.password || "");
      const host = u.hostname || "";
      const port = u.port || "5432";
      const db = (u.pathname || "").replace(/^\//, "");
      console.log(JSON.stringify({ user, pass, host, port, db }));
    } catch (e) {
      console.log("{}");
    }
  ' "$SAMPLE_URL" 2>/dev/null || echo "{}")

  PARSED_USER=$(node -e 'console.log(JSON.parse(process.argv[1]).user || "")' "$PARSED_CREDS" 2>/dev/null || true)
  PARSED_PASS=$(node -e 'console.log(JSON.parse(process.argv[1]).pass || "")' "$PARSED_CREDS" 2>/dev/null || true)
  PARSED_HOST=$(node -e 'console.log(JSON.parse(process.argv[1]).host || "")' "$PARSED_CREDS" 2>/dev/null || true)
  PARSED_PORT=$(node -e 'console.log(JSON.parse(process.argv[1]).port || "")' "$PARSED_CREDS" 2>/dev/null || true)
  PARSED_DB=$(node -e 'console.log(JSON.parse(process.argv[1]).db || "")' "$PARSED_CREDS" 2>/dev/null || true)

  if [ -n "${PARSED_USER}" ] && [ -z "${POSTGRES_USER:-}" ] && [ -z "${EXTERNAL_DB_USER:-}" ]; then
    DB_USER="${PARSED_USER}"
  fi
  if [ -n "${PARSED_PASS}" ] && [ -z "${POSTGRES_PASSWORD:-}" ] && [ -z "${EXTERNAL_DB_PASSWORD:-}" ]; then
    DB_PASS="${PARSED_PASS}"
  fi
  if [ -n "${PARSED_HOST}" ] && [ -z "${EXTERNAL_DB_HOST:-}" ] && [ "${PARSED_HOST}" != "opsknight-db" ]; then
    DB_HOST="${PARSED_HOST}"
    USE_EXTERNAL_DB="true"
    EXTERNAL_DB_HOST="${PARSED_HOST}"
  fi
  if [ -n "${PARSED_PORT}" ] && [ -z "${EXTERNAL_DB_PORT:-}" ]; then
    DB_PORT="${PARSED_PORT}"
  fi
  if [ -n "${PARSED_DB}" ] && [ -z "${POSTGRES_DB:-}" ] && [ -z "${EXTERNAL_DB_NAME:-}" ]; then
    DB_NAME="${PARSED_DB}"
  fi
fi

if [ "${USE_EXTERNAL_DB}" = "true" ]; then
  DB_HOST="${EXTERNAL_DB_HOST:-${DB_HOST}}"
  DB_PORT="${EXTERNAL_DB_PORT:-${DB_PORT}}"
  DB_USER="${EXTERNAL_DB_USER:-${DB_USER}}"
  DB_PASS="${EXTERNAL_DB_PASSWORD:-${DB_PASS}}"
  DB_NAME="${EXTERNAL_DB_NAME:-${DB_NAME}}"

  export EXTERNAL_DB_HOST="${DB_HOST}"
  export EXTERNAL_DB_PORT="${DB_PORT}"
  export EXTERNAL_DB_USER="${DB_USER}"
  export EXTERNAL_DB_PASSWORD="${DB_PASS}"
  export EXTERNAL_DB_NAME="${DB_NAME}"
  export PGBOUNCER_DB_HOST="${DB_HOST}"
  export PGBOUNCER_DB_PORT="${DB_PORT}"
  export PGBOUNCER_DB_NAME="${DB_NAME}"
  export PGBOUNCER_DB_USER="${DB_USER}"

  if [ -z "${DB_HOST}" ] || [ "${DB_HOST}" = "opsknight-db" ]; then
    echo "❌ [FATAL] External database requested but EXTERNAL_DB_HOST is not set." >&2
    exit 1
  fi
fi

echo "═══════════════════════════════════════════════════════════════════════"
echo "  OpsKnight Docker Swarm Safe Rollout Orchestrator"
echo "═══════════════════════════════════════════════════════════════════════"
echo "Stack Name:        ${STACK_NAME}"
echo "Overlay Network:   ${NETWORK_NAME}"
echo "Runtime Mode:      ${SWARM_RUNTIME_MODE}"
echo "Application Image: ${OPSKNIGHT_IMAGE}"
echo "PgBouncer Enabled: ${ENABLE_PGBOUNCER}"
echo "External Database: ${USE_EXTERNAL_DB}"
echo "Environment:       ${ENVIRONMENT} (Strict Secrets: ${STRICT_SECRETS})"
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

# Multi-node storage pinning check for bundled PostgreSQL
if [ "${USE_EXTERNAL_DB}" != "true" ]; then
  NODE_COUNT=$(docker node ls -q 2>/dev/null | wc -l | tr -d ' ')
  if ! docker node ls --filter "node.label=opsknight.database=true" -q 2>/dev/null | grep -q .; then
    if [ "${NODE_COUNT}" -eq 1 ] || [ "${AUTO_LABEL_DATABASE_NODE}" = "true" ]; then
      CURRENT_NODE_ID=$(docker info --format '{{.Swarm.NodeID}}' 2>/dev/null || true)
      echo "🏷️  Auto-labeling single Swarm node (${CURRENT_NODE_ID}) with 'opsknight.database=true'..."
      docker node update --label-add opsknight.database=true "${CURRENT_NODE_ID}" >/dev/null
    else
      echo "❌ [FATAL] Multi-node Swarm cluster detected (${NODE_COUNT} nodes), but no node has label 'opsknight.database=true'." >&2
      echo "   Stateful PostgreSQL volumes must be explicitly pinned to a designated database node." >&2
      echo "   Run: docker node update --label-add opsknight.database=true <NODE-ID>" >&2
      echo "   Or set AUTO_LABEL_DATABASE_NODE=true to override." >&2
      exit 1
    fi
  fi
fi

# --- Step 2: Validate Database Connection Capacity ---
echo "--- [2/8] Running Connection Capacity Pre-flight ---"
export SWARM_NETWORK_NAME="${NETWORK_NAME}"
export SWARM_REPLICAS_WEB="${SWARM_REPLICAS_WEB:-${WEB_REPLICAS:-2}}"
export SWARM_REPLICAS_SCHEDULER="${SWARM_REPLICAS_SCHEDULER:-${SCHEDULER_REPLICAS:-2}}"
export SWARM_REPLICAS_PGBOUNCER="${SWARM_REPLICAS_PGBOUNCER:-${PGBOUNCER_REPLICAS:-2}}"
export SWARM_REPLICAS_INTEGRATED="${SWARM_REPLICAS_INTEGRATED:-${INTEGRATED_REPLICAS:-1}}"
export PGBOUNCER_ENABLED="${ENABLE_PGBOUNCER}"
export ENABLE_PGBOUNCER="${ENABLE_PGBOUNCER}"
export OPSKNIGHT_RUNTIME_MODE="${SWARM_RUNTIME_MODE}"

if [ "${ENABLE_PGBOUNCER}" = "true" ]; then
  export SWARM_STACK_FILE="docker-stack.pgbouncer.yml"
else
  export SWARM_STACK_FILE="docker-stack.yml"
fi

if [ -f "${ROOT_DIR}/scripts/validate-runtime-capacity.cjs" ]; then
  node "${ROOT_DIR}/scripts/validate-runtime-capacity.cjs"
fi

# --- Step 3: Create Overlay Network & Versioned Raft Secrets ---
echo "--- [3/8] Ensuring Overlay Network & Versioned Raft Secrets ---"
if ! docker network inspect "${NETWORK_NAME}" >/dev/null 2>&1; then
  echo "  Creating external attachable overlay network: ${NETWORK_NAME}..."
  docker network create --driver overlay --attachable "${NETWORK_NAME}"
fi

# Configure connection URLs based on database topology
if [ "${USE_EXTERNAL_DB}" = "true" ]; then
  EXTERNAL_DB_SSLMODE="${EXTERNAL_DB_SSLMODE:-verify-full}"
  export EXTERNAL_DB_SSLMODE
  export PGBOUNCER_SERVER_TLS_SSLMODE="${EXTERNAL_DB_SSLMODE}"

  ENCODED_USER=$(node -e 'console.log(encodeURIComponent(process.argv[1]))' "$DB_USER")
  ENCODED_PASS=$(node -e 'console.log(encodeURIComponent(process.argv[1]))' "$DB_PASS")
  CA_PARAM=""
  ensure_sslrootcert() {
    local url="$1"
    local cert_path="/etc/ssl/certs/custom-ca.crt"
    if [ -z "${url}" ]; then echo ""; return; fi
    if [[ "${url}" == *"sslrootcert="* ]]; then echo "${url}"; return; fi
    if [[ "${url}" == *"?"* ]]; then
      echo "${url}&sslrootcert=${cert_path}"
    else
      echo "${url}?sslrootcert=${cert_path}"
    fi
  }

  if [ -n "${PGBOUNCER_TLS_CA_CERT:-}" ] && [ -f "${PGBOUNCER_TLS_CA_CERT}" ]; then
    CA_PARAM="&sslrootcert=/etc/ssl/certs/custom-ca.crt"
    if [ -n "${DIRECT_DATABASE_URL:-}" ]; then
      DIRECT_DATABASE_URL=$(ensure_sslrootcert "${DIRECT_DATABASE_URL}")
      export DIRECT_DATABASE_URL
    fi
    if [ -n "${OPSKNIGHT_DATABASE_URL:-}" ]; then
      OPSKNIGHT_DATABASE_URL=$(ensure_sslrootcert "${OPSKNIGHT_DATABASE_URL}")
      export OPSKNIGHT_DATABASE_URL
    fi
  fi

  if [ -z "${DIRECT_DATABASE_URL:-}" ]; then
    export DIRECT_DATABASE_URL="postgresql://${ENCODED_USER}:${ENCODED_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}?sslmode=${EXTERNAL_DB_SSLMODE}&connection_limit=10&pool_timeout=30${CA_PARAM}"
  fi
  if [ -z "${OPSKNIGHT_DATABASE_URL:-}" ]; then
    export OPSKNIGHT_DATABASE_URL="postgresql://${ENCODED_USER}:${ENCODED_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}?sslmode=${EXTERNAL_DB_SSLMODE}&connection_limit=40&pool_timeout=30${CA_PARAM}"
  fi
  if [ "${ENABLE_PGBOUNCER}" = "true" ]; then
    export WEB_DATABASE_URL="postgresql://${ENCODED_USER}:${ENCODED_PASS}@opsknight-pgbouncer:6432/${DB_NAME}?sslmode=disable&pgbouncer=true"
  else
    export WEB_DATABASE_URL="${OPSKNIGHT_DATABASE_URL}"
  fi
else
  # Bundled PostgreSQL
  ENCODED_USER=$(node -e 'console.log(encodeURIComponent(process.argv[1]))' "$DB_USER")
  ENCODED_PASS=$(node -e 'console.log(encodeURIComponent(process.argv[1]))' "$DB_PASS")

  if [ -z "${DIRECT_DATABASE_URL:-}" ]; then
    export DIRECT_DATABASE_URL="postgresql://${ENCODED_USER}:${ENCODED_PASS}@opsknight-db:5432/${DB_NAME}?sslmode=prefer&connection_limit=10&pool_timeout=30"
  fi
  if [ -z "${OPSKNIGHT_DATABASE_URL:-}" ]; then
    export OPSKNIGHT_DATABASE_URL="postgresql://${ENCODED_USER}:${ENCODED_PASS}@opsknight-db:5432/${DB_NAME}?sslmode=prefer&connection_limit=40&pool_timeout=30"
  fi
  if [ "${ENABLE_PGBOUNCER}" = "true" ]; then
    export WEB_DATABASE_URL="postgresql://${ENCODED_USER}:${ENCODED_PASS}@opsknight-pgbouncer:6432/${DB_NAME}?sslmode=disable&pgbouncer=true"
  else
    export WEB_DATABASE_URL="${OPSKNIGHT_DATABASE_URL}"
  fi
fi

# Robustly escape PgBouncer userlist credentials per PgBouncer auth_file spec:
# Literal double quotes inside quoted strings are doubled (""), backslashes are literal
CLEAN_USER=$(printf '%s' "${DB_USER}" | sed 's/"/""/g')
CLEAN_PASS=$(printf '%s' "${DB_PASS}" | sed 's/"/""/g')
PGBOUNCER_USERLIST_CONTENT=$(printf '"%s" "%s"\n' "${CLEAN_USER}" "${CLEAN_PASS}")

# Export credentials for child processes & stack environment
export POSTGRES_USER="${DB_USER}"
export POSTGRES_PASSWORD="${DB_PASS}"
export PGBOUNCER_DB_USER="${DB_USER}"

# Fail-closed production secrets check
if [ "${STRICT_SECRETS}" = "true" ]; then
  if [ -z "${NEXTAUTH_SECRET:-}" ] || [ "${NEXTAUTH_SECRET}" = "opsknight_super_secret_jwt_and_session_signing_key_change_in_production_min32chars" ]; then
    echo "❌ [FATAL] STRICT_SECRETS enforced: NEXTAUTH_SECRET is empty or using known default placeholder." >&2
    echo "   Provide a secure secret with: export NEXTAUTH_SECRET='...'" >&2
    exit 1
  fi
  if [ -z "${ENCRYPTION_KEY:-}" ] || [ "${ENCRYPTION_KEY}" = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" ]; then
    echo "❌ [FATAL] STRICT_SECRETS enforced: ENCRYPTION_KEY is empty or using known default placeholder." >&2
    echo "   Provide a 64-hex-char encryption key with: export ENCRYPTION_KEY='...'" >&2
    exit 1
  fi
  if [ "${USE_EXTERNAL_DB}" = "true" ]; then
    if [ -z "${DB_PASS}" ] || [ "${DB_PASS}" = "opsknight_secure_password_change_me" ]; then
      echo "❌ [FATAL] STRICT_SECRETS enforced: External database password cannot be empty or use known default placeholder." >&2
      exit 1
    fi
  else
    if [ "${DB_PASS}" = "opsknight_secure_password_change_me" ]; then
      echo "❌ [FATAL] STRICT_SECRETS enforced: POSTGRES_PASSWORD must be changed from the default placeholder." >&2
      exit 1
    fi
  fi
fi

# Fallback values for development / evaluation
NEXTAUTH_SECRET="${NEXTAUTH_SECRET:-opsknight_super_secret_jwt_and_session_signing_key_change_in_production_min32chars}"
ENCRYPTION_KEY="${ENCRYPTION_KEY:-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef}"

# Portable hash helper for Linux/macOS Swarm managers
hash_string() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 | awk '{print $1}'
  elif command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 | awk '{print $NF}'
  else
    cksum | awk '{print $1}'
  fi
}

# Create content-versioned Raft secrets supporting automatic rotation
create_versioned_secret() {
  local base_name="$1"
  local secret_val="$2"
  local env_override_var="$3"

  # Compute content hash for immutable Swarm secret rotation
  local content_hash
  content_hash=$(printf '%s' "${secret_val}" | hash_string | head -c 8)
  local versioned_name="${STACK_NAME}_${base_name}_${content_hash}"

  # If user explicitly overrode the secret name, guarantee immutability & rotation by attaching hash
  local current_env_val="${!env_override_var:-}"
  if [ -n "${current_env_val}" ]; then
    if [[ "${current_env_val}" != *"${content_hash}"* ]]; then
      versioned_name="${current_env_val}_${content_hash}"
    else
      versioned_name="${current_env_val}"
    fi
  fi

  if ! docker secret inspect "${versioned_name}" >/dev/null 2>&1; then
    echo "  Creating versioned secret: ${versioned_name}..."
    printf '%s' "${secret_val}" | docker secret create "${versioned_name}" - >/dev/null
  else
    echo "  Secret ${versioned_name} already exists."
  fi

  # Export environment variable used by docker-stack manifests
  eval "export ${env_override_var}=\"${versioned_name}\""
}

create_versioned_secret "database_url" "${OPSKNIGHT_DATABASE_URL}" "OPSKNIGHT_DATABASE_URL_SECRET"
create_versioned_secret "direct_database_url" "${DIRECT_DATABASE_URL}" "OPSKNIGHT_DIRECT_DATABASE_URL_SECRET"
create_versioned_secret "nextauth_secret" "${NEXTAUTH_SECRET}" "OPSKNIGHT_NEXTAUTH_SECRET_SECRET"
create_versioned_secret "encryption_key" "${ENCRYPTION_KEY}" "OPSKNIGHT_ENCRYPTION_KEY_SECRET"

if [ "${ENABLE_PGBOUNCER}" = "true" ]; then
  create_versioned_secret "pgbouncer_userlist" "${PGBOUNCER_USERLIST_CONTENT}" "OPSKNIGHT_PGBOUNCER_USERLIST_SECRET"
  create_versioned_secret "pgbouncer_db_password" "${DB_PASS}" "OPSKNIGHT_PGBOUNCER_DB_PASSWORD_SECRET"
  create_versioned_secret "web_database_url" "${WEB_DATABASE_URL}" "OPSKNIGHT_WEB_DATABASE_URL_SECRET"
fi

if [ -n "${PGBOUNCER_TLS_CA_CERT:-}" ] && [ -f "${PGBOUNCER_TLS_CA_CERT}" ]; then
  CA_CONTENT=$(cat "${PGBOUNCER_TLS_CA_CERT}")
  create_versioned_secret "custom_ca" "${CA_CONTENT}" "OPSKNIGHT_CUSTOM_CA_SECRET"
fi

# Compose final stack file set
if [ "${SWARM_RUNTIME_MODE}" = "split" ]; then
  RUNTIME_FILE="${SWARM_DIR}/docker-stack.yml"
elif [ "${SWARM_RUNTIME_MODE}" = "integrated" ]; then
  RUNTIME_FILE="${SWARM_DIR}/docker-stack.integrated.yml"
else
  echo "❌ [FATAL] Unknown SWARM_RUNTIME_MODE: '${SWARM_RUNTIME_MODE}'. Must be 'split' or 'integrated'." >&2
  exit 1
fi

STACK_FILES=("-c" "${RUNTIME_FILE}")

if [ "${USE_EXTERNAL_DB}" != "true" ]; then
  STACK_FILES+=("-c" "${SWARM_DIR}/docker-stack.db.yml")
else
  if [ "${SWARM_RUNTIME_MODE}" = "split" ]; then
    STACK_FILES+=("-c" "${SWARM_DIR}/docker-stack.external-db.yml")
  else
    STACK_FILES+=("-c" "${SWARM_DIR}/docker-stack.external-db.integrated.yml")
  fi
fi

if [ "${ENABLE_PGBOUNCER}" = "true" ]; then
  STACK_FILES+=("-c" "${SWARM_DIR}/docker-stack.pgbouncer.yml")
fi

if [ -n "${PGBOUNCER_TLS_CA_CERT:-}" ] && [ -f "${PGBOUNCER_TLS_CA_CERT}" ]; then
  if [ "${SWARM_RUNTIME_MODE}" = "split" ]; then
    STACK_FILES+=("-c" "${SWARM_DIR}/docker-stack.ca.split.yml")
  else
    STACK_FILES+=("-c" "${SWARM_DIR}/docker-stack.ca.integrated.yml")
  fi
  if [ "${ENABLE_PGBOUNCER}" = "true" ]; then
    STACK_FILES+=("-c" "${SWARM_DIR}/docker-stack.pgbouncer-ca.yml")
  fi
fi

DEPLOY_OPTS=("--with-registry-auth")
if [ "${SWARM_RESOLVE_IMAGE_NEVER:-}" = "true" ] || [[ "${OPSKNIGHT_IMAGE:-}" == *local* ]]; then
  DEPLOY_OPTS+=("--resolve-image=never")
fi

# --- Step 4: Bootstrap / Ensure Database Readiness ---
echo "--- [4/8] Ensuring Database Service Readiness ---"
if [ "${USE_EXTERNAL_DB}" = "true" ]; then
  echo "ℹ️  Using external database; skipping bundled PostgreSQL startup."
else
  echo "  Deploying bundled PostgreSQL service manifest..."
  docker stack deploy "${DEPLOY_OPTS[@]}" -c "${SWARM_DIR}/docker-stack.db.yml" "${STACK_NAME}"

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

    # 1. Direct container probe if PostgreSQL task container is on the current node
    TASK_CONTAINER=$(docker ps --filter "label=com.docker.swarm.service.name=${STACK_NAME}_opsknight-db" -q | head -n 1 || true)
    if [ -n "${TASK_CONTAINER}" ]; then
      if docker exec "${TASK_CONTAINER}" pg_isready -U "${DB_USER}" -d "${DB_NAME}" >/dev/null 2>&1; then
        echo "✅ PostgreSQL is accepting connections on local node (${ELAPSED}s)."
        DB_READY=1
        break
      fi
    else
      # 2. Network probe over Swarm overlay network for multi-node clusters
      if docker run --rm --network "${NETWORK_NAME}" postgres:15-alpine pg_isready -h opsknight-db -p 5432 -U "${DB_USER}" -d "${DB_NAME}" >/dev/null 2>&1; then
        echo "✅ PostgreSQL is accepting connections across Swarm overlay network (${ELAPSED}s)."
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
export SWARM_NETWORK_NAME="${NETWORK_NAME}"
export SWARM_STACK_NAME="${STACK_NAME}"
export OPSKNIGHT_DIRECT_DATABASE_URL_SECRET
export OPSKNIGHT_DATABASE_URL_SECRET
export OPSKNIGHT_NEXTAUTH_SECRET_SECRET
export OPSKNIGHT_ENCRYPTION_KEY_SECRET
export OPSKNIGHT_CUSTOM_CA_SECRET
unset DIRECT_DATABASE_URL OPSKNIGHT_DATABASE_URL
"${SCRIPT_DIR}/migrate.sh"

# --- Step 6: Deploy Application Stack with Prune ---
echo "--- [6/8] Deploying OpsKnight Swarm Stack (${SWARM_RUNTIME_MODE} mode with --prune) ---"
docker stack deploy "${DEPLOY_OPTS[@]}" "${STACK_FILES[@]}" --prune "${STACK_NAME}"

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

# --- Step 9: Cleanup Stale Unreferenced Versioned Secrets ---
echo "🧹 Pruning stale unreferenced Raft secrets for stack '${STACK_NAME}'..."
CURRENT_RUN_SECRETS=(
  "${OPSKNIGHT_DATABASE_URL_SECRET:-}"
  "${OPSKNIGHT_DIRECT_DATABASE_URL_SECRET:-}"
  "${OPSKNIGHT_NEXTAUTH_SECRET_SECRET:-}"
  "${OPSKNIGHT_ENCRYPTION_KEY_SECRET:-}"
  "${OPSKNIGHT_PGBOUNCER_USERLIST_SECRET:-}"
  "${OPSKNIGHT_PGBOUNCER_DB_PASSWORD_SECRET:-}"
  "${OPSKNIGHT_WEB_DATABASE_URL_SECRET:-}"
  "${OPSKNIGHT_CUSTOM_CA_SECRET:-}"
)

# Collect all secret names currently mounted across active stack services
ACTIVE_TASK_SECRETS=$(docker service ls --filter "label=com.docker.stack.namespace=${STACK_NAME}" -q 2>/dev/null | while read -r s_id; do
  docker service inspect "$s_id" --format '{{range .Spec.TaskTemplate.ContainerSpec.Secrets}}{{.SecretName}} {{end}}' 2>/dev/null || true
done | tr ' ' '\n' | grep -v '^$' | sort -u || true)

# Prune unreferenced secrets matching stack prefix
for sec in $(docker secret ls --format '{{.Name}}' 2>/dev/null | grep -E "^${STACK_NAME}_" || true); do
  IS_PROTECTED=0
  for cur_sec in "${CURRENT_RUN_SECRETS[@]}"; do
    if [ -n "${cur_sec}" ] && [ "${sec}" = "${cur_sec}" ]; then
      IS_PROTECTED=1
      break
    fi
  done
  [ "${IS_PROTECTED}" -eq 1 ] && continue

  if echo "${ACTIVE_TASK_SECRETS}" | grep -Fxq "${sec}"; then
    continue
  fi

  echo "  Pruned stale secret: ${sec}"
  docker secret rm "${sec}" >/dev/null 2>&1 || true
done

echo ""
echo "🎉 OpsKnight Swarm deployment finished successfully!"
exit 0
