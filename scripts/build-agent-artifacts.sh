#!/usr/bin/env bash
set -euo pipefail

# scripts/build-agent-artifacts.sh
# Packages OpsKnight Native Linux Agent with pinned Node 24 LTS runtime for x86_64 and arm64.

NODE_VERSION="${NODE_VERSION:-v24.14.0}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DIST_DIR="${ROOT_DIR}/dist/agent"

echo "=== Building OpsKnight Agent JS Bundle (Node 24 target) ==="
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

for ARCH in "x64" "arm64"; do
  TARBALL_NAME="opsknight-agent-linux-${ARCH}.tar.gz"
  PACKAGE_DIR="${DIST_DIR}/opsknight-agent-linux-${ARCH}"
  rm -rf "${PACKAGE_DIR}"
  mkdir -p "${PACKAGE_DIR}/runtime/bin"

  # Copy compiled agent code
  cp "${DIST_DIR}/opsknight-agent.mjs" "${PACKAGE_DIR}/"
  cp "${ROOT_DIR}/agent/opsknight-agent.service" "${PACKAGE_DIR}/"
  cp "${ROOT_DIR}/agent/policy.example.json" "${PACKAGE_DIR}/"
  echo "2.0.0" > "${PACKAGE_DIR}/VERSION"

  # Fetch or stage official pinned Node.js runtime if requested/available
  NODE_DIST="node-${NODE_VERSION}-linux-${ARCH}"
  NODE_URL="https://nodejs.org/dist/${NODE_VERSION}/${NODE_DIST}.tar.gz"

  echo "Staging Node ${NODE_VERSION} for linux-${ARCH}..."
  TEMP_NODE_DIR=$(mktemp -d)
  if curl -fsSL "${NODE_URL}" | tar -xz -C "${TEMP_NODE_DIR}" "${NODE_DIST}/bin/node"; then
    cp "${TEMP_NODE_DIR}/${NODE_DIST}/bin/node" "${PACKAGE_DIR}/runtime/bin/node"
    chmod +x "${PACKAGE_DIR}/runtime/bin/node"
  else
    echo "Warning: Unable to fetch prebuilt node from ${NODE_URL}. Creating symlink placeholder."
    ln -sf "/usr/bin/node" "${PACKAGE_DIR}/runtime/bin/node"
  fi
  rm -rf "${TEMP_NODE_DIR}"

  echo "Creating archive: ${DIST_DIR}/${TARBALL_NAME}"
  tar -czf "${DIST_DIR}/${TARBALL_NAME}" -C "${DIST_DIR}" "opsknight-agent-linux-${ARCH}"
  rm -rf "${PACKAGE_DIR}"
done

echo "=== Generating SHA256SUMS ==="
(cd "${DIST_DIR}" && shasum -a 256 opsknight-agent-linux-*.tar.gz > SHA256SUMS || sha256sum opsknight-agent-linux-*.tar.gz > SHA256SUMS)

echo "=== Release Artifacts Generated Successfully in ${DIST_DIR} ==="
ls -lh "${DIST_DIR}"
