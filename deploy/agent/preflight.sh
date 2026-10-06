#!/usr/bin/env bash
set -u

# deploy/agent/preflight.sh
# Diagnostic preflight checker for OpsKnight Native Linux Agent

INSTALL_PREFIX="${OPSKNIGHT_INSTALL_PREFIX:-/opt/opsknight-agent}"
CONFIG_DIR="${OPSKNIGHT_CONFIG_DIR:-/etc/opsknight-agent}"
STATE_DIR="${OPSKNIGHT_STATE_DIR:-/var/lib/opsknight-agent}"
SERVICE_USER="opsknight-agent"

PASSED_COUNT=0
FAILED_COUNT=0
WARNING_COUNT=0

report_pass() {
  local NAME="$1"
  local DETAILS="${2:-}"
  printf "%-25s \033[32mPASS\033[0m %s\n" "${NAME}" "${DETAILS}"
  PASSED_COUNT=$((PASSED_COUNT + 1))
}

report_fail() {
  local NAME="$1"
  local DETAILS="${2:-}"
  printf "%-25s \033[31mFAIL\033[0m %s\n" "${NAME}" "${DETAILS}"
  FAILED_COUNT=$((FAILED_COUNT + 1))
}

report_skip() {
  local NAME="$1"
  local DETAILS="${2:-}"
  printf "%-25s \033[33mSKIP\033[0m %s\n" "${NAME}" "${DETAILS}"
}

report_warn() {
  local NAME="$1"
  local DETAILS="${2:-}"
  printf "%-25s \033[33mWARN\033[0m %s\n" "${NAME}" "${DETAILS}"
  WARNING_COUNT=$((WARNING_COUNT + 1))
}

echo "=========================================================="
echo "          OpsKnight Agent Preflight Diagnostics           "
echo "=========================================================="

# 1. OS & Architecture
if [[ -f /etc/os-release ]]; then
  # shellcheck disable=SC1091
  source /etc/os-release
  report_pass "OS" "${NAME:-Linux} (${VERSION_ID:-})"
else
  report_warn "OS" "Could not read /etc/os-release"
fi

RAW_ARCH="$(uname -m)"
case "${RAW_ARCH}" in
  x86_64|aarch64|arm64)
    report_pass "Architecture" "${RAW_ARCH}"
    ;;
  *)
    report_fail "Architecture" "Unsupported ${RAW_ARCH}"
    ;;
esac

# 2. Runtime
NODE_BIN="${INSTALL_PREFIX}/runtime/bin/node"
if [[ -x "${NODE_BIN}" ]]; then
  NODE_VER="$("${NODE_BIN}" --version 2>/dev/null || echo 'unknown')"
  report_pass "Runtime" "${NODE_VER} (bundled)"
elif command -v node >/dev/null 2>&1; then
  NODE_VER="$(node --version)"
  report_warn "Runtime" "${NODE_VER} (system node, prefer bundled runtime)"
else
  report_fail "Runtime" "Node runtime not found at ${NODE_BIN}"
fi

# 3. Service Account
if getent passwd "${SERVICE_USER}" >/dev/null 2>&1; then
  report_pass "Service user" "${SERVICE_USER}"
else
  report_fail "Service user" "Account ${SERVICE_USER} does not exist"
fi

# 4. State directory & permissions
if [[ -d "${STATE_DIR}" ]]; then
  DIR_OWNER="$(stat -c '%U:%G' "${STATE_DIR}" 2>/dev/null || stat -f '%Su:%Sg' "${STATE_DIR}" 2>/dev/null || echo 'unknown')"
  DIR_MODE="$(stat -c '%a' "${STATE_DIR}" 2>/dev/null || stat -f '%Lp' "${STATE_DIR}" 2>/dev/null || echo 'unknown')"
  if [[ "${DIR_OWNER}" == "${SERVICE_USER}:${SERVICE_USER}" || "${DIR_OWNER}" == "${SERVICE_USER}:"* ]] && [[ "${DIR_MODE}" == "700" || "${DIR_MODE}" == "0700" ]]; then
    report_pass "State directory" "${STATE_DIR} (owner: ${DIR_OWNER}, mode: ${DIR_MODE})"
  else
    report_warn "State directory" "${STATE_DIR} (owner: ${DIR_OWNER}, mode: ${DIR_MODE}, recommend: ${SERVICE_USER} 0700)"
  fi
else
  report_fail "State directory" "${STATE_DIR} not found"
fi

# 5. Core Linux Tools
for TOOL in bash systemctl journalctl df free ps pgrep ss curl; do
  if command -v "${TOOL}" >/dev/null 2>&1; then
    report_pass "${TOOL}" "installed"
  else
    report_fail "${TOOL}" "missing"
  fi
done

# 6. Optional container / k8s tooling
if command -v docker >/dev/null 2>&1; then
  report_pass "Docker" "available ($(docker --version 2>/dev/null | cut -d' ' -f3 || echo 'installed'))"
else
  report_skip "Docker" "not installed (optional)"
fi

if command -v podman >/dev/null 2>&1; then
  report_pass "Podman" "available ($(podman --version 2>/dev/null | cut -d' ' -f3 || echo 'installed'))"
else
  report_skip "Podman" "not installed (optional)"
fi

if command -v kubectl >/dev/null 2>&1; then
  report_pass "Kubernetes" "kubectl available"
else
  report_skip "Kubernetes" "kubectl not installed (optional)"
fi

# 7. Clock Synchronization
CLOCK_OK=false
if command -v chronyc >/dev/null 2>&1 && chronyc tracking >/dev/null 2>&1; then
  report_pass "Clock sync" "chrony active & tracked"
  CLOCK_OK=true
elif command -v timedatectl >/dev/null 2>&1 && timedatectl show 2>/dev/null | grep -E "NTPSynchronized=(yes|1)" >/dev/null 2>&1; then
  report_pass "Clock sync" "systemd-timesyncd synchronized"
  CLOCK_OK=true
fi

if [[ "${CLOCK_OK}" == "false" ]]; then
  report_warn "Clock sync" "NTP/chrony synchronization not verified"
fi

# 8. Control Plane Connectivity & Skew Check
ENV_FILE="${CONFIG_DIR}/agent.env"
OPSKNIGHT_URL=""
if [[ -f "${ENV_FILE}" ]]; then
  OPSKNIGHT_URL="$(grep -E '^OPSKNIGHT_URL=' "${ENV_FILE}" | cut -d'=' -f2- | tr -d '"' | tr -d "'" || true)"
fi
OPSKNIGHT_URL="${OPSKNIGHT_URL:-${OPSKNIGHT_AGENT_URL:-}}"

if [[ -n "${OPSKNIGHT_URL}" ]]; then
  TIME_ENDPOINT="${OPSKNIGHT_URL%/}/api/runbook-agent/v1/time"
  TIME_RESP="$(curl -fsSL -m 5 "${TIME_ENDPOINT}" 2>/dev/null || echo '')"
  if [[ -n "${TIME_RESP}" ]]; then
    report_pass "Control plane" "HTTPS reachable (${OPSKNIGHT_URL})"
  else
    report_warn "Control plane" "Could not query ${TIME_ENDPOINT}"
  fi
else
  report_skip "Control plane" "OPSKNIGHT_URL not set in ${CONFIG_DIR}/agent.env"
fi

echo "=========================================================="
echo "Preflight Summary: ${PASSED_COUNT} Passed, ${WARNING_COUNT} Warnings, ${FAILED_COUNT} Failures"
echo "=========================================================="

if [[ ${FAILED_COUNT} -gt 0 ]]; then
  echo "Result: NOT READY - resolve failed prerequisites before starting service."
  exit 1
else
  echo "Result: READY"
  exit 0
fi
