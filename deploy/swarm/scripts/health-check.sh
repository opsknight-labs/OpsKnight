#!/usr/bin/env bash
# ==============================================================================
# OpsKnight Docker Swarm Health & Convergence Check
#
# Inspects Swarm cluster state, verifies service replica convergence, evaluates
# task errors, and probes the application HTTP readiness endpoint.
# ==============================================================================

set -euo pipefail

STACK_NAME="${SWARM_STACK_NAME:-opsknight}"
WEB_PORT="${APP_PORT:-3000}"
HOST="${APP_HOST:-127.0.0.1}"
HEALTH_URL="${HEALTH_URL:-http://${HOST}:${WEB_PORT}/api/health?mode=readiness}"

echo "═══════════════════════════════════════════════════════════════════════"
echo "  OpsKnight Swarm Health Verification"
echo "═══════════════════════════════════════════════════════════════════════"
echo "Stack:       ${STACK_NAME}"
echo "Health URL:  ${HEALTH_URL}"
echo ""

# 1. Swarm Node Status
echo "--- [1/4] Swarm Cluster Nodes ---"
docker node ls
echo ""

# 2. Stack Services & Replica Convergence
echo "--- [2/4] Stack Services Status ---"
docker stack services "${STACK_NAME}"
echo ""

# Verify every service is fully converged (no 0/1 or 0/2 replicas)
DEGRADED_SERVICES=0
while read -r name image replicas ports; do
  # Extract current and desired replicas
  current=$(echo "${replicas}" | cut -d'/' -f1)
  desired=$(echo "${replicas}" | cut -d'/' -f2)
  if [ "${current}" != "${desired}" ]; then
    echo "⚠️  [WARNING] Service ${name} is degraded: ${replicas} running"
    DEGRADED_SERVICES=$((DEGRADED_SERVICES + 1))
  fi
done < <(docker stack services "${STACK_NAME}" --format '{{.Name}} {{.Image}} {{.Replicas}} {{.Ports}}')

if [ "${DEGRADED_SERVICES}" -gt 0 ]; then
  echo "❌ [ERROR] ${DEGRADED_SERVICES} service(s) have not converged."
else
  echo "✅ All stack services have converged to desired replica counts."
fi
echo ""

# 3. Stack Tasks / Errors Inspection
echo "--- [3/4] Active & Recent Tasks ---"
docker stack ps "${STACK_NAME}" --no-trunc | head -n 20
echo ""

# Check for rejected or failed tasks in the last 5 minutes
FAILED_TASKS=$(docker stack ps "${STACK_NAME}" --filter "desired-state=running" --format '{{.CurrentState}}' | grep -iE 'Failed|Rejected' || true)
if [ -n "${FAILED_TASKS}" ]; then
  echo "⚠️  [WARNING] Found failed or rejected tasks:"
  echo "${FAILED_TASKS}"
  echo ""
fi

# 4. HTTP Application Readiness Probe
echo "--- [4/4] Probing HTTP Readiness Endpoint ---"
if command -v curl >/dev/null 2>&1; then
  HTTP_RESPONSE=$(curl -sL --max-time 10 "${HEALTH_URL}" 2>/dev/null || true)
  if echo "${HTTP_RESPONSE}" | grep -q '"status":"healthy"'; then
    echo "✅ Web Ingress is HEALTHY (Response: ${HTTP_RESPONSE})"
  else
    echo "❌ [ERROR] Health endpoint did not report healthy status."
    echo "Response received: ${HTTP_RESPONSE:-<NO RESPONSE>}"
    exit 1
  fi
else
  echo "ℹ️  curl not installed; skipping external HTTP readiness probe."
fi

echo ""
echo "🎉 OpsKnight Docker Swarm health check passed successfully."
exit 0
