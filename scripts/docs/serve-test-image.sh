#!/usr/bin/env sh
set -eu

compose_file="tests/docs/environment/compose.yaml"
project_name="opsknight-docs-v2-capture"
pull_policy="${DOCS_IMAGE_PULL_POLICY:-always}"

compose() {
  docker compose --project-name "$project_name" -f "$compose_file" "$@"
}

cleanup() {
  compose down --volumes --remove-orphans >/dev/null 2>&1 || true
}

trap cleanup EXIT INT TERM
# The fixed project name and volume are documentation-only. Recreate both so a
# capture never inherits authentication throttles or records from an older run.
compose down --volumes --remove-orphans
compose up -d --pull "$pull_policy" --wait opsknight-app
compose logs --follow opsknight-app
