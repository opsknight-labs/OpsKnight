#!/usr/bin/env bash
# ==============================================================================
# OpsKnight Docker Swarm Safe Rollback Utility
#
# Performs an automated rolling rollback of Swarm application services to their
# previous specification. Note: Database schema rollback must be evaluated
# separately to avoid data loss.
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

SERVICES=(
  "${STACK_NAME}_opsknight-web"
  "${STACK_NAME}_opsknight-scheduler"
  "${STACK_NAME}_opsknight-general-worker"
  "${STACK_NAME}_opsknight-critical-worker"
  "${STACK_NAME}_opsknight-bulk-worker"
  "${STACK_NAME}_opsknight-status-projector"
)

if docker service inspect "${STACK_NAME}_opsknight-pgbouncer" >/dev/null 2>&1; then
  SERVICES+=("${STACK_NAME}_opsknight-pgbouncer")
fi

echo "🔄 Initiating rolling rollback on services..."
for svc in "${SERVICES[@]}"; do
  if docker service inspect "${svc}" >/dev/null 2>&1; then
    echo "  Rolling back service: ${svc}..."
    docker service rollback "${svc}" || echo "  [WARN] Service ${svc} has no prior version to roll back to."
  fi
done

echo ""
echo "⏳ Waiting 15s for rolling rollback convergence..."
sleep 15

echo "🔍 Running health verification..."
"${SCRIPT_DIR}/health-check.sh"
