#!/usr/bin/env sh
set -eu

compose_file="tests/docs/environment/compose.yaml"

cleanup() {
  docker compose -f "$compose_file" down --volumes --remove-orphans >/dev/null 2>&1 || true
}

trap cleanup EXIT INT TERM
# The fixed project name and volume are documentation-only. Recreate both so a
# capture never inherits authentication throttles or records from an older run.
docker compose -f "$compose_file" down --volumes --remove-orphans
docker compose -f "$compose_file" up -d --pull always --wait opsknight-app
docker compose -f "$compose_file" logs --follow opsknight-app
