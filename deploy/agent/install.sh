#!/usr/bin/env bash
set -euo pipefail

# deploy/agent/install.sh
# Enterprise installer for OpsKnight Runbook Native Linux Agent
#
# Usage:
#   sudo ./install.sh --url <https://opsknight.company.com> [--token <one-time-token>] [--key <base64-spki-pin>] [options]

OPSKNIGHT_URL="${OPSKNIGHT_URL:-}"
ENROLLMENT_TOKEN="${ENROLLMENT_TOKEN:-}"
TARBALL_OVERRIDE=""
CHECKSUM_OVERRIDE=""
ALLOW_UNVERIFIED_TARBALL=false
ALLOW_INSECURE_HTTP=false
RELEASE_TAG="${OPSKNIGHT_VERSION:-2.0.0}"
CLEAN_VERSION="${RELEASE_TAG#v}"
CLEAN_TAG="v${CLEAN_VERSION}"
BASE_DOWNLOAD_URL="${OPSKNIGHT_DOWNLOAD_BASE:-https://github.com/opsknight-labs/OpsKnight/releases/download/${CLEAN_TAG}}"
NO_RESTART=false

INSTALL_PREFIX="/opt/opsknight-agent"
CONFIG_DIR="/etc/opsknight-agent"
STATE_DIR="/var/lib/opsknight-agent"
SERVICE_USER="opsknight-agent"
SERVICE_GROUP="opsknight-agent"

EXECUTION_PUBLIC_KEY="${OPSKNIGHT_EXECUTION_PUBLIC_KEY:-}"
EXECUTION_PUBLIC_KEYS_JSON="${OPSKNIGHT_EXECUTION_PUBLIC_KEYS:-}"
TOKEN_FILE=""
KEY_FILE=""
KEYS_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url)
      OPSKNIGHT_URL="$2"
      shift 2
      ;;
    --token)
      ENROLLMENT_TOKEN="$2"
      shift 2
      ;;
    --token-file)
      TOKEN_FILE="$2"
      shift 2
      ;;
    --key|--execution-key)
      EXECUTION_PUBLIC_KEY="$2"
      shift 2
      ;;
    --key-file|--execution-key-file)
      KEY_FILE="$2"
      shift 2
      ;;
    --keys-json|--execution-keys-json)
      EXECUTION_PUBLIC_KEYS_JSON="$2"
      shift 2
      ;;
    --keys-file|--execution-keys-file)
      KEYS_FILE="$2"
      shift 2
      ;;
    --tarball)
      TARBALL_OVERRIDE="$2"
      shift 2
      ;;
    --checksum)
      CHECKSUM_OVERRIDE="$2"
      shift 2
      ;;
    --allow-unverified-tarball)
      ALLOW_UNVERIFIED_TARBALL=true
      shift 1
      ;;
    --allow-insecure-http)
      ALLOW_INSECURE_HTTP=true
      shift 1
      ;;
    --version)
      RELEASE_TAG="$2"
      CLEAN_VERSION="${RELEASE_TAG#v}"
      CLEAN_TAG="v${CLEAN_VERSION}"
      BASE_DOWNLOAD_URL="${OPSKNIGHT_DOWNLOAD_BASE:-https://github.com/opsknight-labs/OpsKnight/releases/download/${CLEAN_TAG}}"
      shift 2
      ;;
    --no-restart)
      NO_RESTART=true
      shift 1
      ;;
    -h|--help)
      echo "Usage: sudo $0 --url <control-plane-url> [options]"
      echo ""
      echo "Options:"
      echo "  --token <token>                  Single-use enrollment token"
      echo "  --token-file <path>              Read enrollment token from file"
      echo "  --key <base64-spki-pin>          Execution public key (Ed25519 SPKI DER base64)"
      echo "  --key-file <path>                Read execution public key from file"
      echo "  --keys-json <json-map>           Plural signing keys JSON (e.g. '{\"default\":\"...\"}')"
      echo "  --keys-file <path>               Read plural signing keys JSON from file"
      echo "  --tarball <path>                 Local artifact archive to install"
      echo "  --checksum <sha256>              Expected SHA256 checksum for local tarball"
      echo "  --allow-unverified-tarball       Allow local tarball without checksum verification"
      echo "  --allow-insecure-http            Allow plain http:// control plane URL (insecure)"
      echo "  --version <tag>                  Release version tag (default: ${RELEASE_TAG})"
      echo "  --no-restart                     Do not restart service if already running"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Read token from file if provided
if [[ -n "${TOKEN_FILE}" ]]; then
  if [[ ! -f "${TOKEN_FILE}" ]]; then
    echo "ERROR: Token file '${TOKEN_FILE}' not found." >&2
    exit 1
  fi
  ENROLLMENT_TOKEN="$(tr -d '\r\n' < "${TOKEN_FILE}")"
fi

# Read key from file if provided
if [[ -n "${KEY_FILE}" ]]; then
  if [[ ! -f "${KEY_FILE}" ]]; then
    echo "ERROR: Execution key file '${KEY_FILE}' not found." >&2
    exit 1
  fi
  EXECUTION_PUBLIC_KEY="$(tr -d '\r\n ' < "${KEY_FILE}")"
fi

# Read keys JSON from file if provided
if [[ -n "${KEYS_FILE}" ]]; then
  if [[ ! -f "${KEYS_FILE}" ]]; then
    echo "ERROR: Execution keys file '${KEYS_FILE}' not found." >&2
    exit 1
  fi
  EXECUTION_PUBLIC_KEYS_JSON="$(cat "${KEYS_FILE}")"
fi

# Canonicalize multiline/formatted keys JSON to single line
if [[ -n "${EXECUTION_PUBLIC_KEYS_JSON}" ]]; then
  if command -v node >/dev/null 2>&1; then
    CANONICAL_JSON="$(node -e 'try { process.stdout.write(JSON.stringify(JSON.parse(process.argv[1]))); } catch(e) { process.exit(1); }' "${EXECUTION_PUBLIC_KEYS_JSON}" 2>/dev/null || echo '')"
    if [[ -n "${CANONICAL_JSON}" ]]; then
      EXECUTION_PUBLIC_KEYS_JSON="${CANONICAL_JSON}"
    fi
  else
    EXECUTION_PUBLIC_KEYS_JSON="$(echo "${EXECUTION_PUBLIC_KEYS_JSON}" | tr -d '\r\n')"
  fi
fi

# Validate local tarball explicitly (fail closed, do not fall back to remote download)
if [[ -n "${TARBALL_OVERRIDE}" ]]; then
  if [[ ! -f "${TARBALL_OVERRIDE}" ]]; then
    echo "ERROR: Specified local tarball '${TARBALL_OVERRIDE}' does not exist." >&2
    exit 1
  fi
fi

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: OpsKnight Agent installer must be run as root (or with sudo)." >&2
  exit 1
fi

# Validate essential configuration arguments
if [[ -z "${OPSKNIGHT_URL}" ]]; then
  echo "ERROR: --url <control-plane-url> is required." >&2
  echo "Example: sudo $0 --url https://opsknight.company.com --key <base64-spki-pin> --token <enrollment-token>" >&2
  exit 1
fi

URL_PROTO="$(echo "${OPSKNIGHT_URL}" | grep -o '^[a-zA-Z]*://' || echo '')"
URL_HOST="$(echo "${OPSKNIGHT_URL}" | sed -E 's|^[a-zA-Z]+://([^:/]+).*|\1|')"

IS_LOOPBACK=false
if [[ "${URL_HOST}" == "localhost" || "${URL_HOST}" == "127.0.0.1" || "${URL_HOST}" == "::1" || "${URL_HOST}" == "0.0.0.0" ]]; then
  IS_LOOPBACK=true
fi

if [[ "${URL_PROTO}" != "https://" ]]; then
  if [[ "${IS_LOOPBACK}" != "true" && "${ALLOW_INSECURE_HTTP}" != "true" ]]; then
    echo "ERROR: OPSKNIGHT_URL must use https:// for secure credential transport." >&2
    echo "Plain http:// is only permitted for loopback testing (127.0.0.1/localhost) or with --allow-insecure-http." >&2
    exit 1
  fi
fi

IDENTITY_FILE="${STATE_DIR}/identity.json"
if [[ ! -f "${IDENTITY_FILE}" && -z "${ENROLLMENT_TOKEN}" ]]; then
  echo "ERROR: --token <enrollment-token> (or --token-file <path>) is required for initial agent enrollment." >&2
  exit 1
fi

if [[ -z "${EXECUTION_PUBLIC_KEY}" && -z "${EXECUTION_PUBLIC_KEYS_JSON}" && ! -f "${CONFIG_DIR}/agent.env" ]]; then
  echo "ERROR: --key <base64-spki-key> or --keys-json <json-map> is required to verify execution envelopes." >&2
  echo "Copy the execution signing key from OpsKnight: Runbooks -> Agents." >&2
  exit 1
fi

# Early cryptographic validation of keys if node is present on host
validate_keys_early() {
  local node_cmd=""
  if command -v node >/dev/null 2>&1; then
    node_cmd="node"
  elif [[ -x "${INSTALL_PREFIX}/runtime/bin/node" ]]; then
    node_cmd="${INSTALL_PREFIX}/runtime/bin/node"
  fi
  if [[ -n "${node_cmd}" ]]; then
    if [[ -n "${EXECUTION_PUBLIC_KEY}" ]]; then
      local clean_k
      clean_k="$(echo "${EXECUTION_PUBLIC_KEY}" | tr -d '\r\n ')"
      if ! "${node_cmd}" -e '
        const { createPublicKey } = require("crypto");
        const pin = process.argv[1];
        if (!pin || pin.length > 200) process.exit(1);
        try {
          const k = createPublicKey({ key: Buffer.from(pin, "base64"), type: "spki", format: "der" });
          if (k.asymmetricKeyType !== "ed25519") process.exit(1);
        } catch {
          process.exit(1);
        }
      ' "${clean_k}" 2>/dev/null; then
        echo "ERROR: Execution key is not a valid base64-encoded Ed25519 SPKI DER public key." >&2
        exit 1
      fi
    fi
    if [[ -n "${EXECUTION_PUBLIC_KEYS_JSON}" ]]; then
      if ! "${node_cmd}" -e '
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
      ' "${EXECUTION_PUBLIC_KEYS_JSON}" 2>/dev/null; then
        echo "ERROR: Execution keys JSON is invalid. Must be a JSON object mapping 1-8 key IDs to valid Ed25519 SPKI DER keys." >&2
        exit 1
      fi
    fi
  fi
}
validate_keys_early

echo "=========================================================="
echo "      OpsKnight Native Linux Agent Enterprise Installer   "
echo "=========================================================="

# 1. Architecture Detection
RAW_ARCH="$(uname -m)"
case "${RAW_ARCH}" in
  x86_64)
    ARCH="x64"
    ;;
  aarch64|arm64)
    ARCH="arm64"
    ;;
  *)
    echo "ERROR: Unsupported CPU architecture: ${RAW_ARCH}." >&2
    echo "OpsKnight Native Agent supports x86_64 and arm64/aarch64 only." >&2
    exit 1
    ;;
esac

# 2. Distro Family Detection
if [[ ! -f /etc/os-release ]]; then
  echo "ERROR: /etc/os-release not found. Unsupported Linux distribution." >&2
  exit 1
fi

# shellcheck disable=SC1091
source /etc/os-release
DISTRO_ID="${ID:-unknown}"
DISTRO_ID_LIKE="${ID_LIKE:-}"

echo "Detected Environment:"
echo "  OS:           ${NAME:-${DISTRO_ID}} (${VERSION_ID:-})"
echo "  Architecture: ${RAW_ARCH} -> linux-${ARCH}"
echo "  System Init:  $(ps -p 1 -o comm= 2>/dev/null || echo 'unknown')"

# 3. Package Manager & Prerequisite Installation
echo ""
echo "=== 1/6 Installing / Verifying System Prerequisites ==="

install_packages() {
  local PKGS=("$@")
  echo "Ensuring required packages: ${PKGS[*]}..."
  if command -v dnf >/dev/null 2>&1; then
    dnf install -y "${PKGS[@]}"
  elif command -v yum >/dev/null 2>&1; then
    yum install -y "${PKGS[@]}"
  elif command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y && apt-get install -y "${PKGS[@]}"
  elif command -v zypper >/dev/null 2>&1; then
    zypper --non-interactive install "${PKGS[@]}"
  else
    echo "WARNING: No known package manager found. Assuming dependencies are pre-installed."
  fi
}

case "${DISTRO_ID}" in
  amzn|rhel|centos|rocky|almalinux|fedora)
    install_packages procps-ng iproute ca-certificates tar gzip curl
    ;;
  ubuntu|debian)
    install_packages procps iproute2 ca-certificates tar gzip curl
    ;;
  sles|opensuse*)
    install_packages procps iproute2 ca-certificates tar gzip curl
    ;;
  *)
    if [[ "${DISTRO_ID_LIKE}" =~ (rhel|fedora) ]]; then
      install_packages procps-ng iproute ca-certificates tar gzip curl
    elif [[ "${DISTRO_ID_LIKE}" =~ (debian|ubuntu) ]]; then
      install_packages procps iproute2 ca-certificates tar gzip curl
    else
      echo "Notice: Unrecognized distro family '${DISTRO_ID}'. Verifying essential binaries manually."
    fi
    ;;
esac

# Verify essential system binaries
REQUIRED_BINS=(bash systemctl journalctl df free ps pgrep ss curl tar gzip)
for BIN in "${REQUIRED_BINS[@]}"; do
  if ! command -v "${BIN}" >/dev/null 2>&1; then
    echo "ERROR: Required system tool '${BIN}' is missing." >&2
    exit 1
  fi
done
echo "Core tools verified: [OK]"

# 4. Clock Synchronization Check
echo ""
echo "=== 2/6 Verifying Clock Synchronization ==="
CLOCK_SYNCED=false
if command -v chronyc >/dev/null 2>&1; then
  if chronyc tracking >/dev/null 2>&1; then
    if ! chronyc tracking 2>/dev/null | grep -iE "Reference ID\s*:\s*0\.0\.0\.0|Leap status\s*:\s*Not synchronised" >/dev/null 2>&1; then
      echo "NTP Status: chrony synchronized [OK]"
      CLOCK_SYNCED=true
    fi
  fi
fi

if [[ "${CLOCK_SYNCED}" == "false" ]] && command -v timedatectl >/dev/null 2>&1; then
  if timedatectl show 2>/dev/null | grep -E "NTPSynchronized=(yes|1)" >/dev/null 2>&1; then
    echo "NTP Status: systemd-timesyncd/timedatectl synchronized [OK]"
    CLOCK_SYNCED=true
  fi
fi

if [[ "${CLOCK_SYNCED}" == "false" ]]; then
  echo "WARNING: Clock synchronization could not be explicitly confirmed."
  echo "Ensure chrony or systemd-timesyncd is synchronized to prevent temporal signature verification errors."
fi

# Check if agent service was already active before replacing
SERVICE_WAS_ACTIVE=false
if command -v systemctl >/dev/null 2>&1; then
  if systemctl is-active --quiet opsknight-agent 2>/dev/null; then
    SERVICE_WAS_ACTIVE=true
    echo "Notice: Active opsknight-agent service detected. Preparing safe upgrade."
  fi
fi

# 5. Service User & Directory Creation
echo ""
echo "=== 3/6 Provisioning Service Identity & Directories ==="
if ! getent group "${SERVICE_GROUP}" >/dev/null 2>&1; then
  groupadd --system "${SERVICE_GROUP}"
  echo "Created system group: ${SERVICE_GROUP}"
fi

if ! getent passwd "${SERVICE_USER}" >/dev/null 2>&1; then
  useradd --system \
    --gid "${SERVICE_GROUP}" \
    --home-dir "${STATE_DIR}" \
    --shell /sbin/nologin \
    --comment "OpsKnight Runbook Native Agent" \
    "${SERVICE_USER}"
  echo "Created system user: ${SERVICE_USER}"
fi

mkdir -p "${INSTALL_PREFIX}"
mkdir -p "${CONFIG_DIR}"
mkdir -p "${STATE_DIR}"

chown -R root:root "${INSTALL_PREFIX}"
chmod 0755 "${INSTALL_PREFIX}"

chown -R root:"${SERVICE_GROUP}" "${CONFIG_DIR}"
chmod 0755 "${CONFIG_DIR}"

chown -R "${SERVICE_USER}:${SERVICE_GROUP}" "${STATE_DIR}"
chmod 0700 "${STATE_DIR}"

# 6. Installation-time Permission Test
echo ""
echo "=== 4/6 Performing State Directory Permission Probe ==="
if ! su -s /bin/bash "${SERVICE_USER}" -c "test -w '${STATE_DIR}'"; then
  echo "ERROR: Service user '${SERVICE_USER}' cannot write to '${STATE_DIR}'." >&2
  echo "Expected owner: ${SERVICE_USER}:${SERVICE_GROUP}, mode: 0700" >&2
  exit 1
fi

# Live write and remove test as service user
TEST_FILE="${STATE_DIR}/.install_probe_$(date +%s)"
if ! su -s /bin/bash "${SERVICE_USER}" -c "touch '${TEST_FILE}' && rm -f '${TEST_FILE}'"; then
  echo "ERROR: Write probe failed in ${STATE_DIR} as user ${SERVICE_USER}." >&2
  exit 1
fi
echo "State directory permissions verified: [OK] (owner: ${SERVICE_USER}, mode: 0700)"

# 7. Unpack or Download Agent Bundle
echo ""
echo "=== 5/6 Deploying Agent Bundle & Runtime ==="
TEMP_WORK_DIR=$(mktemp -d)
trap 'rm -rf "${TEMP_WORK_DIR}"' EXIT

TARBALL_FILE=""
if [[ -n "${TARBALL_OVERRIDE}" ]]; then
  echo "Using local override artifact: ${TARBALL_OVERRIDE}"
  TARBALL_FILE="${TARBALL_OVERRIDE}"
  TARBALL_DIR="$(cd "$(dirname "${TARBALL_OVERRIDE}")" && pwd)"
  TARBALL_BASE="$(basename "${TARBALL_OVERRIDE}")"

  if [[ -n "${CHECKSUM_OVERRIDE}" ]]; then
    echo "Verifying local tarball against provided checksum..."
    ACTUAL_SHA="$(sha256sum "${TARBALL_FILE}" 2>/dev/null | awk '{print $1}' || shasum -a 256 "${TARBALL_FILE}" | awk '{print $1}')"
    if [[ "${CHECKSUM_OVERRIDE}" != "${ACTUAL_SHA}" ]]; then
      echo "ERROR: Local artifact checksum mismatch! Expected ${CHECKSUM_OVERRIDE}, got ${ACTUAL_SHA}." >&2
      exit 1
    fi
    echo "Local artifact checksum verified: [OK]"
  elif [[ -f "${TARBALL_OVERRIDE}.sha256" ]]; then
    echo "Verifying local tarball with ${TARBALL_OVERRIDE}.sha256..."
    EXPECTED_SHA="$(awk '{print $1}' "${TARBALL_OVERRIDE}.sha256" | head -n 1)"
    ACTUAL_SHA="$(sha256sum "${TARBALL_FILE}" 2>/dev/null | awk '{print $1}' || shasum -a 256 "${TARBALL_FILE}" | awk '{print $1}')"
    if [[ "${EXPECTED_SHA}" != "${ACTUAL_SHA}" ]]; then
      echo "ERROR: Local artifact checksum mismatch! Expected ${EXPECTED_SHA}, got ${ACTUAL_SHA}." >&2
      exit 1
    fi
    echo "Local artifact checksum verified: [OK]"
  elif [[ -f "${TARBALL_DIR}/SHA256SUMS" ]] && grep -q "${TARBALL_BASE}" "${TARBALL_DIR}/SHA256SUMS" 2>/dev/null; then
    echo "Verifying local tarball against ${TARBALL_DIR}/SHA256SUMS..."
    if ! (cd "${TARBALL_DIR}" && grep "${TARBALL_BASE}" SHA256SUMS | sha256sum -c - 2>/dev/null || (cd "${TARBALL_DIR}" && grep "${TARBALL_BASE}" SHA256SUMS | shasum -a 256 -c - 2>/dev/null)); then
      echo "ERROR: SHA256 checksum verification failed for ${TARBALL_BASE}." >&2
      exit 1
    fi
    echo "Local artifact checksum verified: [OK]"
  elif [[ "${ALLOW_UNVERIFIED_TARBALL}" == "true" ]]; then
    echo "Notice: Installing unverified local artifact (--allow-unverified-tarball specified)."
  else
    echo "ERROR: Integrity verification required for local tarball '${TARBALL_OVERRIDE}'." >&2
    echo "Provide --checksum <sha256>, place a checksum in '${TARBALL_OVERRIDE}.sha256', provide SHA256SUMS alongside, or pass --allow-unverified-tarball." >&2
    exit 1
  fi
else
  ARTIFACT_NAME="opsknight-agent-linux-${ARCH}.tar.gz"
  ARTIFACT_URL="${BASE_DOWNLOAD_URL}/${ARTIFACT_NAME}"
  CHECKSUM_URL="${BASE_DOWNLOAD_URL}/SHA256SUMS"

  echo "Downloading ${ARTIFACT_URL}..."
  if ! curl -fsSL -o "${TEMP_WORK_DIR}/${ARTIFACT_NAME}" "${ARTIFACT_URL}"; then
    echo "ERROR: Failed to download official release artifact from ${ARTIFACT_URL}." >&2
    exit 1
  fi
  TARBALL_FILE="${TEMP_WORK_DIR}/${ARTIFACT_NAME}"

  # Verify Checksum strictly for remote downloads
  if ! curl -fsSL -o "${TEMP_WORK_DIR}/SHA256SUMS" "${CHECKSUM_URL}"; then
    echo "ERROR: Failed to download SHA256SUMS from ${CHECKSUM_URL}." >&2
    echo "Refusing to install unverified remote artifacts." >&2
    exit 1
  fi
  echo "Verifying artifact checksum..."
  if ! (cd "${TEMP_WORK_DIR}" && grep "${ARTIFACT_NAME}" SHA256SUMS | sha256sum -c - 2>/dev/null || (cd "${TEMP_WORK_DIR}" && grep "${ARTIFACT_NAME}" SHA256SUMS | shasum -a 256 -c - 2>/dev/null)); then
    echo "ERROR: SHA256 checksum verification failed for ${ARTIFACT_NAME}." >&2
    exit 1
  fi
  echo "Artifact checksum verified: [OK]"
fi

# Stage extraction in a temporary location for transactional upgrade
STAGE_DIR=$(mktemp -d "${INSTALL_PREFIX}.staging.XXXXXX" 2>/dev/null || mktemp -d "/tmp/opsknight-agent.staging.XXXXXX")
echo "Staging bundle extraction into ${STAGE_DIR}..."
tar -xzf "${TARBALL_FILE}" --strip-components=1 -C "${STAGE_DIR}"
chown -R root:root "${STAGE_DIR}"
chmod -R u=rwX,go=rX "${STAGE_DIR}"
chmod 0755 "${STAGE_DIR}/runtime/bin/node" 2>/dev/null || true

# Verify bundled node compatibility with host libc (glibc >= 2.28)
if ! "${STAGE_DIR}/runtime/bin/node" -e 'process.exit(0)' 2>/dev/null; then
  echo "ERROR: The bundled Node 24 runtime cannot execute on this host." >&2
  echo "This host lacks a compatible C standard library (requires glibc >= 2.28)." >&2
  rm -rf "${STAGE_DIR}"
  exit 1
fi
echo "Bundled Node runtime verified compatible: [OK]"

# Cryptographic key verification using staged Node runtime
if [[ -n "${EXECUTION_PUBLIC_KEY}" ]]; then
  CLEAN_KEY="$(echo "${EXECUTION_PUBLIC_KEY}" | tr -d '\r\n ')"
  if ! "${STAGE_DIR}/runtime/bin/node" -e '
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
    echo "ERROR: Execution key is not a valid base64-encoded Ed25519 SPKI DER public key." >&2
    rm -rf "${STAGE_DIR}"
    exit 1
  fi
fi

if [[ -n "${EXECUTION_PUBLIC_KEYS_JSON}" ]]; then
  CANONICAL_JSON="$("${STAGE_DIR}/runtime/bin/node" -e '
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
      process.stdout.write(JSON.stringify(obj));
    } catch {
      process.exit(1);
    }
  ' "${EXECUTION_PUBLIC_KEYS_JSON}" 2>/dev/null || echo '')"
  if [[ -z "${CANONICAL_JSON}" ]]; then
    echo "ERROR: Execution keys JSON is invalid. Must be a JSON object mapping 1-8 key IDs to valid Ed25519 SPKI DER keys." >&2
    rm -rf "${STAGE_DIR}"
    exit 1
  fi
  EXECUTION_PUBLIC_KEYS_JSON="${CANONICAL_JSON}"
fi

# Prepare transactional backup for rollback on any failure
BACKUP_DIR=$(mktemp -d "/opt/opsknight-agent.backup.XXXXXX" 2>/dev/null || mktemp -d "/tmp/opsknight-agent.backup.XXXXXX")
LEGACY_DIR="/usr/local/lib/opsknight-agent"
LEGACY_LAYOUT=false
if [[ -d "${LEGACY_DIR}" ]]; then
  LEGACY_LAYOUT=true
fi

if [[ -d "${INSTALL_PREFIX}" && -n "$(ls -A "${INSTALL_PREFIX}" 2>/dev/null)" ]]; then
  cp -a "${INSTALL_PREFIX}" "${BACKUP_DIR}/opt"
fi
if [[ -f "${CONFIG_DIR}/agent.env" ]]; then
  cp -a "${CONFIG_DIR}/agent.env" "${BACKUP_DIR}/agent.env"
fi
if [[ -f "/etc/systemd/system/opsknight-agent.service" ]]; then
  cp -a "/etc/systemd/system/opsknight-agent.service" "${BACKUP_DIR}/opsknight-agent.service"
fi
if [[ -f "${CONFIG_DIR}/policy.json" ]]; then
  cp -a "${CONFIG_DIR}/policy.json" "${BACKUP_DIR}/policy.json"
fi

rollback_and_fail() {
  local error_msg="${1:-Installation failed.}"
  trap - ERR
  echo "ERROR: ${error_msg}" >&2
  echo "Initiating transactional rollback to previous installation..." >&2

  # 1. Restore /opt independently
  if [[ -d "${BACKUP_DIR}/opt" ]]; then
    rm -rf "${INSTALL_PREFIX}"
    mv "${BACKUP_DIR}/opt" "${INSTALL_PREFIX}"
  else
    rm -rf "${INSTALL_PREFIX}"
  fi

  # 2. Restore systemd service unit independently
  if [[ -f "${BACKUP_DIR}/opsknight-agent.service" ]]; then
    cp -a "${BACKUP_DIR}/opsknight-agent.service" /etc/systemd/system/opsknight-agent.service
  elif [[ -f "/etc/systemd/system/opsknight-agent.service" ]]; then
    rm -f /etc/systemd/system/opsknight-agent.service
  fi

  # 3. Restore agent.env independently
  if [[ -f "${BACKUP_DIR}/agent.env" ]]; then
    cp -a "${BACKUP_DIR}/agent.env" "${CONFIG_DIR}/agent.env"
  fi

  # 4. Restore policy.json independently
  if [[ -f "${BACKUP_DIR}/policy.json" ]]; then
    cp -a "${BACKUP_DIR}/policy.json" "${CONFIG_DIR}/policy.json"
  fi

  # 5. Clean up drain flags
  rm -f "${STATE_DIR}/drain" "${STATE_DIR}/drain-ready"

  # 6. Reload and restart previous service if it was active
  if command -v systemctl >/dev/null 2>&1; then
    systemctl daemon-reload 2>/dev/null || true
    if [[ "${SERVICE_WAS_ACTIVE}" == "true" ]]; then
      echo "Restarting previous service..." >&2
      systemctl restart opsknight-agent 2>/dev/null || true
    fi
  fi

  rm -rf "${BACKUP_DIR}" "${STAGE_DIR:-}"
  echo "Rollback to previous installation completed." >&2
  exit 1
}

# Arm transaction-wide error trap across staging activation, configuration, and restart
trap 'rollback_and_fail "Command failed on line $LINENO (exit code $?)."' ERR

# Swap staged directory into target
rm -rf "${INSTALL_PREFIX}"
if ! mv "${STAGE_DIR}" "${INSTALL_PREFIX}"; then
  rollback_and_fail "Failed to activate staged installation directory."
fi

# Install preflight script to /opt/opsknight-agent if bundled or present
if [[ -f "${INSTALL_PREFIX}/preflight.sh" ]]; then
  chmod 0755 "${INSTALL_PREFIX}/preflight.sh"
elif [[ -f "deploy/agent/preflight.sh" ]]; then
  cp "deploy/agent/preflight.sh" "${INSTALL_PREFIX}/preflight.sh"
  chmod 0755 "${INSTALL_PREFIX}/preflight.sh"
fi

# Install systemd unit
if [[ -f "${INSTALL_PREFIX}/opsknight-agent.service" ]]; then
  cp "${INSTALL_PREFIX}/opsknight-agent.service" /etc/systemd/system/opsknight-agent.service
  chmod 0644 /etc/systemd/system/opsknight-agent.service
  if command -v systemctl >/dev/null 2>&1; then
    systemctl daemon-reload
  fi
fi

# Seed policy.json if not present
if [[ ! -f "${CONFIG_DIR}/policy.json" && -f "${INSTALL_PREFIX}/policy.example.json" ]]; then
  cp "${INSTALL_PREFIX}/policy.example.json" "${CONFIG_DIR}/policy.json"
  chmod 0644 "${CONFIG_DIR}/policy.json"
fi

# 8. Configure Environment & Preflight
echo ""
echo "=== 6/6 Configuring Agent & Service Startup ==="
ENV_FILE="${CONFIG_DIR}/agent.env"
if [[ ! -f "${ENV_FILE}" ]]; then
  touch "${ENV_FILE}"
fi
chmod 0600 "${ENV_FILE}"
chown root:root "${ENV_FILE}"

if [[ -n "${OPSKNIGHT_URL}" ]]; then
  sed -i '/^OPSKNIGHT_URL=/d' "${ENV_FILE}" 2>/dev/null || true
  echo "OPSKNIGHT_URL=${OPSKNIGHT_URL}" >> "${ENV_FILE}"
fi

if [[ -n "${ENROLLMENT_TOKEN}" ]]; then
  sed -i '/^OPSKNIGHT_AGENT_ENROLLMENT_TOKEN=/d' "${ENV_FILE}" 2>/dev/null || true
  echo "OPSKNIGHT_AGENT_ENROLLMENT_TOKEN=${ENROLLMENT_TOKEN}" >> "${ENV_FILE}"
fi

# Prevent silent key shadowing:
# If plural keys JSON is provided, set it and clear singular key.
# If singular key is provided, set it and clear plural keys.
if [[ -n "${EXECUTION_PUBLIC_KEYS_JSON}" ]]; then
  sed -i '/^OPSKNIGHT_EXECUTION_PUBLIC_KEYS=/d' "${ENV_FILE}" 2>/dev/null || true
  sed -i '/^OPSKNIGHT_EXECUTION_PUBLIC_KEY=/d' "${ENV_FILE}" 2>/dev/null || true
  echo "OPSKNIGHT_EXECUTION_PUBLIC_KEYS=${EXECUTION_PUBLIC_KEYS_JSON}" >> "${ENV_FILE}"
elif [[ -n "${EXECUTION_PUBLIC_KEY}" ]]; then
  sed -i '/^OPSKNIGHT_EXECUTION_PUBLIC_KEY=/d' "${ENV_FILE}" 2>/dev/null || true
  sed -i '/^OPSKNIGHT_EXECUTION_PUBLIC_KEYS=/d' "${ENV_FILE}" 2>/dev/null || true
  CLEAN_KEY="$(echo "${EXECUTION_PUBLIC_KEY}" | tr -d '\r\n ')"
  echo "OPSKNIGHT_EXECUTION_PUBLIC_KEY=${CLEAN_KEY}" >> "${ENV_FILE}"
fi

# 9. Active service drain & restart on upgrade
if [[ "${SERVICE_WAS_ACTIVE}" == "true" ]] && command -v systemctl >/dev/null 2>&1; then
  if [[ "${NO_RESTART}" == "true" ]]; then
    echo "Notice: opsknight-agent service is currently running."
    echo "Skipping automatic restart (--no-restart requested)."
    echo "To restart manually: sudo systemctl restart opsknight-agent"
  else
    AGENT_PID="$(systemctl show opsknight-agent --property=MainPID --value 2>/dev/null || echo "0")"
    if [[ "${AGENT_PID}" -gt 0 ]]; then
      echo "Requesting Agent drain via ${STATE_DIR}/drain..."
      touch "${STATE_DIR}/drain"
      chown "${SERVICE_USER}:${SERVICE_USER}" "${STATE_DIR}/drain" 2>/dev/null || true
      rm -f "${STATE_DIR}/drain-ready"

      DRAIN_WAITED=0
      DRAINED=false
      while [[ ${DRAIN_WAITED} -lt 30 ]]; do
        if [[ -f "${STATE_DIR}/drain-ready" ]]; then
          DRAINED=true
          echo "Agent execution drain complete: [OK]"
          break
        fi
        sleep 1
        DRAIN_WAITED=$((DRAIN_WAITED + 1))
      done
      if [[ "${DRAINED}" != "true" ]]; then
        echo "WARNING: In-flight execution did not complete within 30s. Interruption will record target state as UNKNOWN." >&2
      fi
    fi

    RESTART_START_TIME="$(date +%s000 2>/dev/null || node -e 'console.log(Date.now())' 2>/dev/null || echo "0")"
    echo "Restarting opsknight-agent service..."
    if ! systemctl restart opsknight-agent; then
      rollback_and_fail "systemctl restart opsknight-agent failed."
    fi

    echo "Verifying service startup and runtime health..."
    HEALTH_VERIFIED=false
    CHECK_ATTEMPTS=0
    while [[ ${CHECK_ATTEMPTS} -lt 15 ]]; do
      sleep 1
      CHECK_ATTEMPTS=$((CHECK_ATTEMPTS + 1))

      if ! systemctl is-active --quiet opsknight-agent 2>/dev/null; then
        continue
      fi

      NEW_PID="$(systemctl show opsknight-agent --property=MainPID --value 2>/dev/null || echo "0")"
      if [[ -z "${NEW_PID}" || "${NEW_PID}" == "0" || "${NEW_PID}" == "${AGENT_PID}" ]]; then
        continue
      fi

      HEALTH_FILE="${STATE_DIR}/health.json"
      if [[ -f "${HEALTH_FILE}" ]]; then
        if "${INSTALL_PREFIX}/runtime/bin/node" -e '
          const fs = require("fs");
          try {
            const h = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
            const targetPid = parseInt(process.argv[2], 10);
            const minTime = parseInt(process.argv[3], 10);
            if (h.pid === targetPid && h.ready === true && h.updatedAt >= (minTime - 10000)) {
              process.exit(0);
            }
          } catch {}
          process.exit(1);
        ' "${HEALTH_FILE}" "${NEW_PID}" "${RESTART_START_TIME}" 2>/dev/null; then
          HEALTH_VERIFIED=true
          break
        fi
      fi
    done

    if [[ "${HEALTH_VERIFIED}" != "true" ]]; then
      rollback_and_fail "Agent service restart did not reach healthy active state with valid health.json. Check logs: sudo journalctl -u opsknight-agent -n 50"
    fi
    echo "Agent service successfully restarted and verified healthy (PID ${NEW_PID}): [OK]"
  fi
fi

# Health verification succeeded; disarm trap and clean up
trap - ERR
rm -f "${STATE_DIR}/drain" "${STATE_DIR}/drain-ready"
if [[ "${LEGACY_LAYOUT}" == "true" && -d "${LEGACY_DIR}" ]]; then
  echo "Cleaning up legacy layout at ${LEGACY_DIR}..."
  rm -rf "${LEGACY_DIR}"
fi
rm -rf "${BACKUP_DIR}"

echo "Installed successfully at ${INSTALL_PREFIX}."
echo ""
echo "=========================================================="
echo "                   INSTALLATION COMPLETE                  "
echo "=========================================================="
echo "Next steps:"
echo "  1. Review policy:   ${CONFIG_DIR}/policy.json"
echo "  2. Review config:   ${CONFIG_DIR}/agent.env"
echo "  3. Run preflight:   sudo ${INSTALL_PREFIX}/preflight.sh"
echo "  4. Start service:   sudo systemctl enable --now opsknight-agent"
echo "=========================================================="
