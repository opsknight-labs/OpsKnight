#!/usr/bin/env bash
set -euo pipefail

# deploy/agent/install.sh
# Enterprise installer for OpsKnight Runbook Native Linux Agent
#
# Usage:
#   sudo ./install.sh [--url <https://opsknight.company.com>] [--token <one-time-token>] [--tarball <path-to-tarball>]

OPSKNIGHT_URL="${OPSKNIGHT_URL:-}"
ENROLLMENT_TOKEN="${ENROLLMENT_TOKEN:-}"
TARBALL_OVERRIDE=""
RELEASE_TAG="${OPSKNIGHT_VERSION:-2.0.0}"
BASE_DOWNLOAD_URL="${OPSKNIGHT_DOWNLOAD_BASE:-https://github.com/opsknight-labs/OpsKnight/releases/download/v${RELEASE_TAG}}"

INSTALL_PREFIX="/opt/opsknight-agent"
CONFIG_DIR="/etc/opsknight-agent"
STATE_DIR="/var/lib/opsknight-agent"
SERVICE_USER="opsknight-agent"
SERVICE_GROUP="opsknight-agent"

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
    --tarball)
      TARBALL_OVERRIDE="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: sudo $0 [--url <control-plane-url>] [--token <enrollment-token>] [--tarball <local-tarball>]"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: OpsKnight Agent installer must be run as root (or with sudo)." >&2
  exit 1
fi

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
    echo "NTP Status: chrony synchronized [OK]"
    CLOCK_SYNCED=true
  fi
fi

if [[ "${CLOCK_SYNCED}" == "false" ]] && command -v timedatectl >/dev/null 2>&1; then
  if timedatectl show 2>/dev/null | grep -E "NTPSynchronized=(yes|1)|NTP=yes" >/dev/null 2>&1; then
    echo "NTP Status: systemd-timesyncd/timedatectl synchronized [OK]"
    CLOCK_SYNCED=true
  fi
fi

if [[ "${CLOCK_SYNCED}" == "false" ]]; then
  echo "WARNING: Clock synchronization could not be explicitly confirmed."
  echo "Ensure chrony or systemd-timesyncd is running to prevent temporal signature verification errors."
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
if [[ -n "${TARBALL_OVERRIDE}" && -f "${TARBALL_OVERRIDE}" ]]; then
  echo "Using local override artifact: ${TARBALL_OVERRIDE}"
  TARBALL_FILE="${TARBALL_OVERRIDE}"
else
  ARTIFACT_NAME="opsknight-agent-linux-${ARCH}.tar.gz"
  ARTIFACT_URL="${BASE_DOWNLOAD_URL}/${ARTIFACT_NAME}"
  CHECKSUM_URL="${BASE_DOWNLOAD_URL}/SHA256SUMS"

  echo "Downloading ${ARTIFACT_URL}..."
  if ! curl -fsSL -o "${TEMP_WORK_DIR}/${ARTIFACT_NAME}" "${ARTIFACT_URL}"; then
    echo "Warning: Direct release download not reachable. Checking local repository build..."
    if [[ -f "./dist/agent/${ARTIFACT_NAME}" ]]; then
      cp "./dist/agent/${ARTIFACT_NAME}" "${TEMP_WORK_DIR}/${ARTIFACT_NAME}"
    else
      echo "ERROR: Could not download or locate ${ARTIFACT_NAME}." >&2
      exit 1
    fi
  fi
  TARBALL_FILE="${TEMP_WORK_DIR}/${ARTIFACT_NAME}"

  # Verify Checksum if SHA256SUMS is available
  if curl -fsSL -o "${TEMP_WORK_DIR}/SHA256SUMS" "${CHECKSUM_URL}" 2>/dev/null || [[ -f "./dist/agent/SHA256SUMS" ]]; then
    [[ -f "./dist/agent/SHA256SUMS" && ! -f "${TEMP_WORK_DIR}/SHA256SUMS" ]] && cp "./dist/agent/SHA256SUMS" "${TEMP_WORK_DIR}/"
    echo "Verifying artifact checksum..."
    (cd "${TEMP_WORK_DIR}" && grep "${ARTIFACT_NAME}" SHA256SUMS | sha256sum -c - || grep "${ARTIFACT_NAME}" SHA256SUMS | shasum -a 256 -c -)
    echo "Artifact checksum verified: [OK]"
  fi
fi

# Extract into /opt/opsknight-agent
echo "Extracting bundle to ${INSTALL_PREFIX}..."
tar -xzf "${TARBALL_FILE}" --strip-components=1 -C "${INSTALL_PREFIX}"
chown -R root:root "${INSTALL_PREFIX}"
chmod -R u=rwX,go=rX "${INSTALL_PREFIX}"
chmod 0755 "${INSTALL_PREFIX}/runtime/bin/node" 2>/dev/null || true

# Install systemd unit
if [[ -f "${INSTALL_PREFIX}/opsknight-agent.service" ]]; then
  cp "${INSTALL_PREFIX}/opsknight-agent.service" /etc/systemd/system/opsknight-agent.service
  chmod 0644 /etc/systemd/system/opsknight-agent.service
  systemctl daemon-reload
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
chown "${SERVICE_USER}:${SERVICE_GROUP}" "${ENV_FILE}"

if [[ -n "${OPSKNIGHT_URL}" ]]; then
  sed -i '/^OPSKNIGHT_URL=/d' "${ENV_FILE}" 2>/dev/null || true
  echo "OPSKNIGHT_URL=${OPSKNIGHT_URL}" >> "${ENV_FILE}"
fi

if [[ -n "${ENROLLMENT_TOKEN}" ]]; then
  sed -i '/^OPSKNIGHT_ENROLLMENT_TOKEN=/d' "${ENV_FILE}" 2>/dev/null || true
  echo "OPSKNIGHT_ENROLLMENT_TOKEN=${ENROLLMENT_TOKEN}" >> "${ENV_FILE}"
fi

echo "Installed successfully at ${INSTALL_PREFIX}."
echo ""
echo "=========================================================="
echo "                   INSTALLATION COMPLETE                  "
echo "=========================================================="
echo "Next steps:"
echo "  1. Review policy:   ${CONFIG_DIR}/policy.json"
echo "  2. Review config:   ${CONFIG_DIR}/agent.env"
echo "  3. Run preflight:   ${INSTALL_PREFIX}/preflight.sh (or deploy/agent/preflight.sh)"
echo "  4. Start service:   sudo systemctl enable --now opsknight-agent"
echo "=========================================================="
