#!/usr/bin/env bash
set -euo pipefail

# scripts/build-agent-artifacts.sh
# Packages OpsKnight Native Linux Agent with pinned Node 24 LTS runtime for x86_64 and arm64.

NODE_VERSION="${NODE_VERSION:-v24.21.0}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DIST_DIR="${ROOT_DIR}/dist/agent"

# Resolve dynamic version from package.json or git tag
PACKAGE_VERSION="$(node -p 'require("./package.json").version' 2>/dev/null || echo '2.0.0')"
RELEASE_VERSION="${OPSKNIGHT_VERSION:-${PACKAGE_VERSION}}"

echo "=== Building OpsKnight Agent JS Bundle v${RELEASE_VERSION} (Node 24 target) ==="
mkdir -p "${DIST_DIR}"
npx esbuild "${ROOT_DIR}/agent/src/index.ts" \
  --bundle \
  --platform=node \
  --target=node24 \
  --format=esm \
  --packages=external \
  --banner:js='import { createRequire as __cr } from "module"; const require = __cr(import.meta.url);' \
  --outfile="${DIST_DIR}/opsknight-agent.mjs"

echo "=== Packaging Platform Tarballs with Bundled Node ==="

# Fetch official Node SHASUMS256.txt once
NODE_SHASUMS_URL="https://nodejs.org/dist/${NODE_VERSION}/SHASUMS256.txt"
SHASUMS_FILE="${DIST_DIR}/NODE_SHASUMS256.txt"
if ! curl -fsSL -o "${SHASUMS_FILE}" "${NODE_SHASUMS_URL}"; then
  echo "ERROR: Failed to download Node SHASUMS from ${NODE_SHASUMS_URL}." >&2
  exit 1
fi

for ARCH in "x64" "arm64"; do
  TARBALL_NAME="opsknight-agent-linux-${ARCH}.tar.gz"
  PACKAGE_DIR="${DIST_DIR}/opsknight-agent-linux-${ARCH}"
  rm -rf "${PACKAGE_DIR}"
  mkdir -p "${PACKAGE_DIR}/runtime/bin"

  # Copy compiled agent code, preflight, policy, service unit, and dynamic VERSION
  cp "${DIST_DIR}/opsknight-agent.mjs" "${PACKAGE_DIR}/"
  cp "${ROOT_DIR}/agent/opsknight-agent.service" "${PACKAGE_DIR}/"
  cp "${ROOT_DIR}/agent/policy.example.json" "${PACKAGE_DIR}/"
  cp "${ROOT_DIR}/deploy/agent/preflight.sh" "${PACKAGE_DIR}/"
  chmod +x "${PACKAGE_DIR}/preflight.sh"
  echo "${RELEASE_VERSION}" > "${PACKAGE_DIR}/VERSION"

  # Copy licenses and notices if available
  if [[ -f "${ROOT_DIR}/LICENSE" ]]; then
    cp "${ROOT_DIR}/LICENSE" "${PACKAGE_DIR}/LICENSE"
  fi
  if [[ -f "${ROOT_DIR}/NOTICE" ]]; then
    cp "${ROOT_DIR}/NOTICE" "${PACKAGE_DIR}/NOTICE"
  fi

  # Fetch and cryptographically verify official pinned Node.js runtime archive
  NODE_DIST="node-${NODE_VERSION}-linux-${ARCH}"
  NODE_TAR="${NODE_DIST}.tar.gz"
  NODE_URL="https://nodejs.org/dist/${NODE_VERSION}/${NODE_TAR}"

  echo "Fetching and verifying pinned Node ${NODE_VERSION} for linux-${ARCH}..."
  TEMP_NODE_DIR=$(mktemp -d)
  if ! curl -fsSL -o "${TEMP_NODE_DIR}/${NODE_TAR}" "${NODE_URL}"; then
    echo "ERROR: Failed to download official Node runtime from ${NODE_URL}." >&2
    rm -rf "${TEMP_NODE_DIR}"
    exit 1
  fi

  # Verify Node official SHA256
  EXPECTED_SHA="$(grep "${NODE_TAR}" "${SHASUMS_FILE}" | awk '{print $1}')"
  if [[ -z "${EXPECTED_SHA}" ]]; then
    echo "ERROR: Could not find expected checksum for ${NODE_TAR} in ${NODE_SHASUMS_URL}." >&2
    rm -rf "${TEMP_NODE_DIR}"
    exit 1
  fi
  ACTUAL_SHA="$(sha256sum "${TEMP_NODE_DIR}/${NODE_TAR}" 2>/dev/null | awk '{print $1}' || shasum -a 256 "${TEMP_NODE_DIR}/${NODE_TAR}" | awk '{print $1}')"
  if [[ "${EXPECTED_SHA}" != "${ACTUAL_SHA}" ]]; then
    echo "ERROR: Checksum mismatch for ${NODE_TAR}! Expected ${EXPECTED_SHA}, got ${ACTUAL_SHA}." >&2
    rm -rf "${TEMP_NODE_DIR}"
    exit 1
  fi
  echo "Node runtime ${NODE_TAR} cryptographically verified: [OK]"

  # Extract verified node binary and official Node LICENSE
  tar -xzf "${TEMP_NODE_DIR}/${NODE_TAR}" -C "${TEMP_NODE_DIR}" "${NODE_DIST}/bin/node" "${NODE_DIST}/LICENSE"
  cp "${TEMP_NODE_DIR}/${NODE_DIST}/bin/node" "${PACKAGE_DIR}/runtime/bin/node"
  chmod +x "${PACKAGE_DIR}/runtime/bin/node"
  if [[ -f "${TEMP_NODE_DIR}/${NODE_DIST}/LICENSE" ]]; then
    cp "${TEMP_NODE_DIR}/${NODE_DIST}/LICENSE" "${PACKAGE_DIR}/runtime/LICENSE-NODE"
  fi
  rm -rf "${TEMP_NODE_DIR}"

  echo "Creating archive: ${DIST_DIR}/${TARBALL_NAME}"
  tar -czf "${DIST_DIR}/${TARBALL_NAME}" -C "${DIST_DIR}" "opsknight-agent-linux-${ARCH}"
  rm -rf "${PACKAGE_DIR}"
done
rm -f "${SHASUMS_FILE}"

# Also copy install.sh and preflight.sh to dist directory for release distribution
cp "${ROOT_DIR}/deploy/agent/install.sh" "${DIST_DIR}/"
sed -i.bak "s/RELEASE_TAG=\"\${OPSKNIGHT_VERSION:-2.0.0}\"/RELEASE_TAG=\"\${OPSKNIGHT_VERSION:-${RELEASE_VERSION}}\"/" "${DIST_DIR}/install.sh" && rm -f "${DIST_DIR}/install.sh.bak"
cp "${ROOT_DIR}/deploy/agent/preflight.sh" "${DIST_DIR}/"

echo "=== Generating SHA256SUMS ==="
(cd "${DIST_DIR}" && shasum -a 256 opsknight-agent-linux-*.tar.gz install.sh preflight.sh > SHA256SUMS || sha256sum opsknight-agent-linux-*.tar.gz install.sh preflight.sh > SHA256SUMS)

echo "=== Release Artifacts Generated Successfully in ${DIST_DIR} ==="
ls -lh "${DIST_DIR}"
