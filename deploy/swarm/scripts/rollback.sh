#!/usr/bin/env bash
# ==============================================================================
# OpsKnight Docker Swarm Safe Rollback Utility
#
# Performs an automated rolling rollback of Swarm application services to their
# previous specification across split and integrated topologies.
# Note: Database schema rollback must be evaluated separately to avoid data loss.
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STACK_NAME="${SWARM_STACK_NAME:-opsknight}"

echo "═══════════════════════════════════════════════════════════════════════"
echo "  OpsKnight Swarm Service Rollback"
echo "═══════════════════════════════════════════════════════════════════════"
echo "Stack: ${STACK_NAME}"
echo ""

echo "⚠️  [IMPORTANT] Database Schema Notice:"
echo "   Rolling back container images does NOT automatically revert database migrations."
echo "   Ensure your previous application version is forward-compatible with the"
echo "   current database schema before proceeding."
echo ""

SERVICES=()

# Detect topology: integrated vs split
if docker service inspect "${STACK_NAME}_opsknight-app" >/dev/null 2>&1; then
  echo "Detected topology: integrated runtime"
  SERVICES+=("${STACK_NAME}_opsknight-app")
else
  echo "Detected topology: split runtime"
  SPLIT_CANDIDATES=(
    "${STACK_NAME}_opsknight-web"
    "${STACK_NAME}_opsknight-scheduler"
    "${STACK_NAME}_opsknight-general-worker"
    "${STACK_NAME}_opsknight-critical-worker"
    "${STACK_NAME}_opsknight-bulk-worker"
    "${STACK_NAME}_opsknight-status-projector"
  )
  for svc in "${SPLIT_CANDIDATES[@]}"; do
    if docker service inspect "${svc}" >/dev/null 2>&1; then
      SERVICES+=("${svc}")
    fi
  done
fi

if docker service inspect "${STACK_NAME}_opsknight-pgbouncer" >/dev/null 2>&1; then
  SERVICES+=("${STACK_NAME}_opsknight-pgbouncer")
fi

if [ ${#SERVICES[@]} -eq 0 ]; then
  echo "⚠️  [WARN] No active OpsKnight application services found in stack '${STACK_NAME}' to roll back."
  exit 0
fi

echo "🔄 Initiating rolling rollback on services..."
for svc in "${SERVICES[@]}"; do
  echo "  Rolling back service: ${svc}..."
  docker service rollback "${svc}" || echo "  [WARN] Service ${svc} has no prior version to roll back to."
done

echo ""
echo "⏳ Waiting 15s for rolling rollback convergence..."
sleep 15

echo "🔍 Running health verification..."
"${SCRIPT_DIR}/health-check.sh"
