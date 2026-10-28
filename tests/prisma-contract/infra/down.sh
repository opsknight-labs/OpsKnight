#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
docker compose -f "$HERE/compose.yml" down -v --remove-orphans
