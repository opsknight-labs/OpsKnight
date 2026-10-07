#!/usr/bin/env bash
set -u

# deploy/agent/preflight.sh
# Diagnostic preflight checker for OpsKnight Native Linux Agent

INSTALL_PREFIX="${OPSKNIGHT_INSTALL_PREFIX:-/opt/opsknight-agent}"
CONFIG_DIR="${OPSKNIGHT_CONFIG_DIR:-/etc/opsknight-agent}"
STATE_DIR="${OPSKNIGHT_STATE_DIR:-/var/lib/opsknight-agent}"
SERVICE_USER="opsknight-agent"

# Check if agent.env is unreadable due to 0600 permissions
ENV_FILE="${CONFIG_DIR}/agent.env"
if [[ -f "${ENV_FILE}" && ! -r "${ENV_FILE}" ]]; then
  echo "ERROR: Cannot read ${ENV_FILE} (permission denied)." >&2
  echo "Because ${ENV_FILE} is secured with mode 0600 (root:root), please run preflight with sudo:" >&2
  echo "  sudo ${INSTALL_PREFIX}/preflight.sh" >&2
  exit 1
fi

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

# 2. Runtime & libc compatibility
NODE_BIN="${INSTALL_PREFIX}/runtime/bin/node"
if [[ -x "${NODE_BIN}" ]]; then
  if NODE_VER="$("${NODE_BIN}" -e 'console.log(process.version)' 2>/dev/null)" && [[ -n "${NODE_VER}" ]]; then
    report_pass "Runtime" "${NODE_VER} (bundled Node 24 runtime, execution verified)"
  else
    report_fail "Runtime" "Bundled node binary at ${NODE_BIN} failed to execute (requires glibc >= 2.28)"
  fi
elif command -v node >/dev/null 2>&1; then
  if NODE_VER="$(node -e 'console.log(process.version)' 2>/dev/null)" && [[ -n "${NODE_VER}" ]]; then
    report_warn "Runtime" "${NODE_VER} (system node; recommend bundled runtime in ${INSTALL_PREFIX})"
  else
    report_fail "Runtime" "System node binary failed to execute"
  fi
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
  if ! chronyc tracking 2>/dev/null | grep -iE "Reference ID\s*:\s*0\.0\.0\.0|Leap status\s*:\s*Not synchronised" >/dev/null 2>&1; then
    report_pass "Clock sync" "chrony active & synchronized"
    CLOCK_OK=true
  fi
elif command -v timedatectl >/dev/null 2>&1 && timedatectl show 2>/dev/null | grep -E "NTPSynchronized=(yes|1)" >/dev/null 2>&1; then
  report_pass "Clock sync" "systemd-timesyncd synchronized"
  CLOCK_OK=true
fi

if [[ "${CLOCK_OK}" == "false" ]]; then
  report_warn "Clock sync" "NTP/chrony synchronization not verified"
fi

# 8. Configuration & Security Key Requirements
OPSKNIGHT_URL=""
EXECUTION_KEY=""
EXECUTION_KEYS=""
ENROLLMENT_TOKEN=""

if [[ -f "${ENV_FILE}" ]]; then
  OPSKNIGHT_URL="$(grep -E '^OPSKNIGHT_URL=' "${ENV_FILE}" | cut -d'=' -f2- | tr -d '"' | tr -d "'" || true)"
  EXECUTION_KEY="$(grep -E '^OPSKNIGHT_EXECUTION_PUBLIC_KEY=' "${ENV_FILE}" | cut -d'=' -f2- | tr -d '"' | tr -d "'" || true)"
  EXECUTION_KEYS="$(grep -E '^OPSKNIGHT_EXECUTION_PUBLIC_KEYS=' "${ENV_FILE}" | cut -d'=' -f2- || true)"
  ENROLLMENT_TOKEN="$(grep -E '^OPSKNIGHT_AGENT_ENROLLMENT_TOKEN=' "${ENV_FILE}" | cut -d'=' -f2- | tr -d '"' | tr -d "'" || true)"
fi
OPSKNIGHT_URL="${OPSKNIGHT_URL:-${OPSKNIGHT_AGENT_URL:-}}"
EXECUTION_KEY="${EXECUTION_KEY:-${OPSKNIGHT_EXECUTION_PUBLIC_KEY:-}}"
EXECUTION_KEYS="${EXECUTION_KEYS:-${OPSKNIGHT_EXECUTION_PUBLIC_KEYS:-}}"
ENROLLMENT_TOKEN="${ENROLLMENT_TOKEN:-${OPSKNIGHT_AGENT_ENROLLMENT_TOKEN:-}}"

# 8a. Control plane URL
if [[ -n "${OPSKNIGHT_URL}" ]]; then
  report_pass "Control plane URL" "${OPSKNIGHT_URL}"
else
  report_fail "Control plane URL" "OPSKNIGHT_URL missing in ${ENV_FILE}"
fi

# 8b. Execution public key pin & validation
NODE_RUNNER=""
if [[ -x "${NODE_BIN}" ]]; then
  NODE_RUNNER="${NODE_BIN}"
elif command -v node >/dev/null 2>&1; then
  NODE_RUNNER="node"
fi

if [[ -n "${EXECUTION_KEYS}" ]]; then
  if [[ -n "${EXECUTION_KEY}" ]]; then
    report_warn "Execution key shadowing" "OPSKNIGHT_EXECUTION_PUBLIC_KEYS takes precedence over OPSKNIGHT_EXECUTION_PUBLIC_KEY"
  fi
  KEYS_VALID=false
  if [[ -n "${NODE_RUNNER}" ]]; then
    if "${NODE_RUNNER}" -e '
      const { createPublicKey } = require("crypto");
      const jsonStr = process.argv[1];
      try {
        const obj = JSON.parse(jsonStr);
        if (!obj || typeof obj !== "object" || Array.isArray(obj)) process.exit(1);
        const entries = Object.entries(obj);
        if (entries.length === 0 || entries.length > 8) process.exit(1);
        for (const [id, pin] of entries) {
          if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id) || typeof pin !== "string" || pin.length > 200) process.exit(1);
          const k = createPublicKey({ key: Buffer.from(pin, "base64"), type: "spki", format: "der" });
          if (k.asymmetricKeyType !== "ed25519") process.exit(1);
        }
      } catch {
        process.exit(1);
      }
    ' "${EXECUTION_KEYS}" 2>/dev/null; then
      KEYS_VALID=true
    fi
  else
    KEYS_VALID=true
  fi
  if [[ "${KEYS_VALID}" == "true" ]]; then
    report_pass "Execution signing keys" "plural key map valid (Ed25519 SPKI DER)"
  else
    report_fail "Execution signing keys" "invalid JSON key map or invalid Ed25519 key in OPSKNIGHT_EXECUTION_PUBLIC_KEYS"
  fi
elif [[ -n "${EXECUTION_KEY}" ]]; then
  KEY_VALID=false
  CLEAN_KEY="$(echo "${EXECUTION_KEY}" | tr -d '\r\n ')"
  if [[ -n "${NODE_RUNNER}" ]]; then
    if "${NODE_RUNNER}" -e '
      const { createPublicKey } = require("crypto");
      const pin = process.argv[1];
      if (!pin || pin.length > 200) process.exit(1);
      try {
        const k = createPublicKey({ key: Buffer.from(pin, "base64"), type: "spki", format: "der" });
        if (k.asymmetricKeyType !== "ed25519") process.exit(1);
      } catch {
        process.exit(1);
      }
    ' "${CLEAN_KEY}" 2>/dev/null; then
      KEY_VALID=true
    fi
  else
    KEY_VALID=true
  fi
  if [[ "${KEY_VALID}" == "true" ]]; then
    report_pass "Execution signing key" "pinned (base64 SPKI DER Ed25519)"
  else
    report_fail "Execution signing key" "invalid Ed25519 SPKI DER key in OPSKNIGHT_EXECUTION_PUBLIC_KEY"
  fi
else
  report_fail "Execution signing key" "OPSKNIGHT_EXECUTION_PUBLIC_KEY or OPSKNIGHT_EXECUTION_PUBLIC_KEYS missing in ${ENV_FILE}"
fi

# 8c. Identity or Enrollment Token
IDENTITY_FILE="${STATE_DIR}/identity.json"
if [[ -f "${IDENTITY_FILE}" ]]; then
  report_pass "Agent identity" "enrolled (${IDENTITY_FILE} present)"
elif [[ -n "${ENROLLMENT_TOKEN}" ]]; then
  report_pass "Enrollment token" "provided (ready for initial enrollment)"
else
  report_fail "Agent identity" "Neither existing ${IDENTITY_FILE} nor OPSKNIGHT_AGENT_ENROLLMENT_TOKEN is present"
fi

# 9. Control Plane Connectivity & Clock Skew Measurement
if [[ -n "${OPSKNIGHT_URL}" ]]; then
  TIME_ENDPOINT="${OPSKNIGHT_URL%/}/api/runbook-agent/v1/time"
  TIME_RESP="$(curl -fsSL -m 5 "${TIME_ENDPOINT}" 2>/dev/null || echo '')"
  if [[ -n "${TIME_RESP}" ]]; then
    SERVER_EPOCH="$(echo "${TIME_RESP}" | grep -o '"epochMs":[0-9]*' | cut -d':' -f2 || echo '')"
    if [[ -n "${SERVER_EPOCH}" ]]; then
      LOCAL_EPOCH="$(date +%s000 2>/dev/null || node -e 'console.log(Date.now())' 2>/dev/null || echo '')"
      if [[ -n "${LOCAL_EPOCH}" ]]; then
        SKEW_MS=$(( LOCAL_EPOCH - SERVER_EPOCH ))
        if [[ ${SKEW_MS} -lt 0 ]]; then SKEW_MS=$(( -SKEW_MS )); fi
        SKEW_SEC=$(( SKEW_MS / 1000 ))
        if [[ ${SKEW_SEC} -le 30 ]]; then
          report_pass "Control plane clock" "skew ${SKEW_SEC}s (healthy <=30s)"
        elif [[ ${SKEW_SEC} -le 60 ]]; then
          report_warn "Control plane clock" "skew ${SKEW_SEC}s (warning >30s, max 60s)"
        else
          report_fail "Control plane clock" "skew ${SKEW_SEC}s exceeds 60s limit"
        fi
      else
        report_pass "Control plane clock" "connected (${OPSKNIGHT_URL})"
      fi
    else
      report_pass "Control plane clock" "connected (${OPSKNIGHT_URL})"
    fi
  else
    report_fail "Control plane clock" "Could not connect to ${TIME_ENDPOINT}"
  fi
else
  report_fail "Control plane clock" "Cannot connect: OPSKNIGHT_URL not configured"
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
