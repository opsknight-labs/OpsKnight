#!/bin/sh
# Source of truth: docs/versions.json (releasedVersions list)
# Copies released doc trees to website repo content/docs/<version>
# and public/docs/<version>/assets. Unreleased versions are safely skipped.

set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WEBSITE_DIR="${1:-$ROOT_DIR/../opsknight-website}"
SRC_DIR="$ROOT_DIR/docs"
VERSIONS_FILE="$SRC_DIR/versions.json"

if [ ! -d "$SRC_DIR" ]; then
  echo "Docs folder not found: $SRC_DIR" >&2
  exit 1
fi

if [ ! -d "$WEBSITE_DIR" ]; then
  echo "Website repo not found: $WEBSITE_DIR" >&2
  exit 1
fi

echo "Syncing app docs to website..."

sync_docs_dir() {
  src="$1"
  dest="$2"

  mkdir -p "$dest"
  rsync -av --delete \
    --exclude '.DS_Store' \
    "$src/" "$dest/"
}

sync_assets() {
  src="$1/assets"
  dest="$2/assets"
  if [ -d "$src" ]; then
    mkdir -p "$dest"
    rsync -av --delete --exclude '.DS_Store' "$src/" "$dest/"
  fi
}

# Determine which versions to sync
ALLOWED_VERSIONS=""
if [ -f "$VERSIONS_FILE" ] && command -v node >/dev/null 2>&1; then
  ALLOWED_VERSIONS=$(node -e '
    const fs = require("fs");
    try {
      const v = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      if (Array.isArray(v.releasedVersions)) {
        console.log(v.releasedVersions.join(" "));
      }
    } catch (e) {
      process.exit(1);
    }
  ' "$VERSIONS_FILE" || true)
fi

found_versions=0

if [ -n "$ALLOWED_VERSIONS" ]; then
  echo "Enforcing release-gated versions from docs/versions.json: $ALLOWED_VERSIONS"
  for version in $ALLOWED_VERSIONS; do
    version_dir="$SRC_DIR/$version"
    if [ -d "$version_dir" ]; then
      dest_dir="$WEBSITE_DIR/content/docs/$version"
      public_assets_dir="$WEBSITE_DIR/public/docs/$version"
      echo " - $version -> $dest_dir"
      sync_docs_dir "$version_dir" "$dest_dir"
      sync_assets "$version_dir" "$public_assets_dir"
      found_versions=1
    fi
  done
else
  for version_dir in "$SRC_DIR"/v*; do
    if [ -d "$version_dir" ]; then
      version="$(basename "$version_dir")"
      dest_dir="$WEBSITE_DIR/content/docs/$version"
      public_assets_dir="$WEBSITE_DIR/public/docs/$version"
      echo " - $version -> $dest_dir"
      sync_docs_dir "$version_dir" "$dest_dir"
      sync_assets "$version_dir" "$public_assets_dir"
      found_versions=1
    fi
  done
fi

if [ "$found_versions" -eq 0 ]; then
  version="v1"
  dest_dir="$WEBSITE_DIR/content/docs/$version"
  public_assets_dir="$WEBSITE_DIR/public/docs/$version"
  echo " - $version (fallback) -> $dest_dir"
  sync_docs_dir "$SRC_DIR" "$dest_dir"
  sync_assets "$SRC_DIR" "$public_assets_dir"
fi

echo "Done."

