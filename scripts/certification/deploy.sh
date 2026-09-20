#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/infra/certification/docker-compose.yml"

MODE="local"
TARGET_HOST=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --local)
      MODE="local"
      shift
      ;;
    --remote)
      MODE="remote"
      TARGET_HOST="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

echo "=== Deploying OpsKnight Certification Topology ($MODE) ==="

if [ "$MODE" = "local" ]; then
  docker compose -f "$COMPOSE_FILE" down -v --remove-orphans || true
  docker compose -f "$COMPOSE_FILE" up -d

  echo "Waiting for services to become healthy..."
  MAX_WAIT=60
  ELAPSED=0
  until [ $(docker inspect --format='{{json .State.Health.Status}}' infra-opsknight-db-1 2>/dev/null || echo '"unknown"') == '"healthy"' ]; do
    sleep 2
    ELAPSED=$((ELAPSED + 2))
    if [ $ELAPSED -ge $MAX_WAIT ]; then
      echo "❌ Timeout waiting for database health"
      docker compose -f "$COMPOSE_FILE" logs
      exit 1
    fi
  done
  echo "✅ Local certification topology is healthy."

elif [ "$MODE" = "remote" ]; then
  if [ -z "$TARGET_HOST" ]; then
    echo "❌ --remote requires a target host/IP"
    exit 1
  fi

  echo "Copying compose configuration to $TARGET_HOST..."
  scp -o StrictHostKeyChecking=no "$COMPOSE_FILE" "ubuntu@$TARGET_HOST:/opt/opsknight-certification/docker-compose.yml"

  echo "Starting containers on $TARGET_HOST..."
  ssh -o StrictHostKeyChecking=no "ubuntu@$TARGET_HOST" "
    cd /opt/opsknight-certification
    docker compose down -v --remove-orphans || true
    docker compose up -d
  "

  echo "✅ Remote certification topology started on $TARGET_HOST."
fi
