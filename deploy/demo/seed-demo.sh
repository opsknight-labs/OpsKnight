#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${REPO_ROOT}"

echo "🌱 Initializing OpsKnight demo dataset..."

ENV_FILE="${SCRIPT_DIR}/.env"
if [ -f "${ENV_FILE}" ]; then
  # Safely load key-value pairs without executing arbitrary commands
  while IFS='=' read -r key val || [ -n "$key" ]; do
    [[ "$key" =~ ^[[:space:]]*# ]] && continue
    [ -z "$key" ] && continue
    # Trim leading/trailing whitespace
    key="$(echo -n "$key" | xargs)"
    val="$(echo -n "$val" | xargs)"
    export "$key"="$val"
  done < "${ENV_FILE}"
fi

POSTGRES_USER="${POSTGRES_USER:-opsknight}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-opsknight_demo_password}"
POSTGRES_DB="${POSTGRES_DB:-opsknight_demo}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"

export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_PORT}/${POSTGRES_DB}?sslmode=prefer"
export DIRECT_DATABASE_URL="${DATABASE_URL}"
export DEMO_MODE="true"

# Verify node modules are ready
if [ ! -d "node_modules" ] || [ ! -f "node_modules/.bin/ts-node" ]; then
  echo "📦 Installing seed dependencies..."
  npm install --prefer-offline --no-audit --no-fund
fi

# Ensure prisma client is generated
if [ ! -d "node_modules/.prisma/client" ]; then
  echo "⚡ Generating Prisma Client..."
  npx prisma generate
fi

npm run seed:demo

echo "✅ Demo dataset seeded successfully."
