#!/bin/sh
# Source of truth: docs/v1, docs/v1.1, docs/v1.2, docs/v1.3, docs/v1.4
# Copies those trees to the website repo content/docs/<version>
# and public/docs/<version>/assets. See .github/workflows/docs-sync.yml.
# Not copied: docs/core-concepts, docs/images, ARCHITECTURE_ANALYSIS.md.

set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WEBSITE_DIR="${1:-$ROOT_DIR/../opsknight-website}"
SRC_DIR="$ROOT_DIR/docs"
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

found_versions=0
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

if [ "$found_versions" -eq 0 ]; then
  version="v1"
  dest_dir="$WEBSITE_DIR/content/docs/$version"
  public_assets_dir="$WEBSITE_DIR/public/docs/$version"
  echo " - $version (fallback) -> $dest_dir"
  sync_docs_dir "$SRC_DIR" "$dest_dir"
  sync_assets "$SRC_DIR" "$public_assets_dir"
fi

echo "Done."
