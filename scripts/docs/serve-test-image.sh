#!/usr/bin/env sh
set -eu

compose_file="tests/docs/environment/compose.yaml"

cleanup() {
  docker compose -f "$compose_file" stop opsknight-app >/dev/null 2>&1 || true
}

trap cleanup EXIT INT TERM
docker compose -f "$compose_file" up -d --pull always --wait opsknight-app
docker compose -f "$compose_file" logs --follow opsknight-app
