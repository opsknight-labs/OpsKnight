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
TOTAL_SERVICES=0
DEGRADED_SERVICES=0
while read -r name image replicas ports; do
  [ -z "${replicas}" ] && continue
  TOTAL_SERVICES=$((TOTAL_SERVICES + 1))
  # Extract current and desired replicas
  current=$(echo "${replicas}" | cut -d'/' -f1)
  desired=$(echo "${replicas}" | cut -d'/' -f2)
  if [ "${current}" != "${desired}" ]; then
    echo "⚠️  [WARNING] Service ${name} is degraded: ${replicas} running"
    DEGRADED_SERVICES=$((DEGRADED_SERVICES + 1))
  fi
done < <(docker stack services "${STACK_NAME}" --format '{{.Name}} {{.Image}} {{.Replicas}} {{.Ports}}' 2>/dev/null || true)

if [ "${TOTAL_SERVICES}" -eq 0 ]; then
  echo "❌ [ERROR] No services found running for stack '${STACK_NAME}'."
  exit 1
fi

if [ "${DEGRADED_SERVICES}" -gt 0 ]; then
  echo "❌ [ERROR] ${DEGRADED_SERVICES} service(s) have not converged to desired replica counts."
  exit 1
else
  echo "✅ All stack services have converged to desired replica counts."
fi
echo ""

# 3. Stack Tasks / Errors Inspection
echo "--- [3/4] Active & Recent Tasks ---"
docker stack ps "${STACK_NAME}" --no-trunc 2>&1 | head -n 20 || true
echo ""

# Check for rejected or failed tasks
FAILED_TASKS=$(docker stack ps "${STACK_NAME}" --filter "desired-state=running" --format '{{.CurrentState}}' 2>/dev/null | grep -iE 'Failed|Rejected' || true)
if [ -n "${FAILED_TASKS}" ]; then
  echo "❌ [ERROR] Found failed or rejected tasks:"
  echo "${FAILED_TASKS}"
  exit 1
fi

# 4. HTTP Application Readiness Probe
echo "--- [4/4] Probing HTTP Readiness Endpoint ---"
PROBE_ATTEMPTS=6
PROBE_INTERVAL=5
HTTP_SUCCESS=0

run_http_probe() {
  if command -v curl >/dev/null 2>&1; then
    curl -sL --max-time 10 "${HEALTH_URL}" 2>/dev/null || true
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- -T 10 "${HEALTH_URL}" 2>/dev/null || true
  else
    # In-cluster container fallback: probe web service directly via local task container
    local web_container
    web_container=$(docker ps --filter "name=${STACK_NAME}_opsknight-web" --filter "status=running" -q 2>/dev/null | head -n 1 || true)
    if [ -z "${web_container}" ]; then
      web_container=$(docker ps --filter "name=${STACK_NAME}_opsknight-app" --filter "status=running" -q 2>/dev/null | head -n 1 || true)
    fi
    if [ -n "${web_container}" ]; then
      docker exec "${web_container}" node -e "require('http').get('http://127.0.0.1:3000/api/health?mode=readiness', (r) => {let d='';r.on('data',c=>d+=c);r.on('end',()=>{process.stdout.write(d);process.exit(0)})}).on('error',()=>{process.exit(1)})" 2>/dev/null || true
    else
      echo "NO_PROBE_MECHANISM"
    fi
  fi
}

for ((i=1; i<=PROBE_ATTEMPTS; i++)); do
  HTTP_RESPONSE=$(run_http_probe)
  if [ "${HTTP_RESPONSE}" = "NO_PROBE_MECHANISM" ]; then
    echo "❌ [ERROR] No HTTP probe tool available on host (curl or wget) and no running web container found." >&2
    exit 1
  fi
  if echo "${HTTP_RESPONSE}" | grep -q '"status":"healthy"'; then
    echo "✅ Web Ingress is HEALTHY (Response: ${HTTP_RESPONSE})"
    HTTP_SUCCESS=1
    break
  fi
  if [ "$i" -lt "$PROBE_ATTEMPTS" ]; then
    echo "  [Attempt $i/${PROBE_ATTEMPTS}] Health endpoint not ready yet, retrying in ${PROBE_INTERVAL}s..."
    sleep "${PROBE_INTERVAL}"
  fi
done

if [ "${HTTP_SUCCESS}" -ne 1 ]; then
  echo "❌ [ERROR] Health endpoint did not report healthy status after ${PROBE_ATTEMPTS} attempts." >&2
  echo "Response received: ${HTTP_RESPONSE:-<NO RESPONSE>}" >&2
  exit 1
fi

echo ""
echo "🎉 OpsKnight Docker Swarm health check passed successfully."
exit 0
