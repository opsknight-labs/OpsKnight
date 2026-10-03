#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${REPO_ROOT}"

# Remove stale expiry marker if restarting
rm -f "${REPO_ROOT}/.demo-expired"

echo "==================================================================="
echo "🛡️  OpsKnight Demo: Preparing isolated environment..."
echo "==================================================================="

# 1. Determine origin / host
if [ -n "${CODESPACE_NAME:-}" ]; then
  DOMAIN="${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
  DEMO_HOST="${CODESPACE_NAME}-3000.${DOMAIN}"
  DEMO_URL="https://${DEMO_HOST}"
else
  DEMO_HOST="localhost:3000"
  DEMO_URL="http://localhost:3000"
fi

# 2. Generate or refresh session secrets
ENV_FILE="${SCRIPT_DIR}/.env"
if [ ! -f "${ENV_FILE}" ]; then
  echo "🔑 Generating fresh ephemeral encryption & session keys..."
  POSTGRES_USER="opsknight"
  POSTGRES_DB="opsknight_demo"
  POSTGRES_PORT="${POSTGRES_PORT:-5432}"

  gen_secret() {
    openssl rand -hex "$1" 2>/dev/null || node -e "console.log(crypto.randomBytes($1).toString('hex'))"
  }

  POSTGRES_PASSWORD="$(gen_secret 16)"
  NEXTAUTH_SECRET="$(gen_secret 32)"
  API_KEY_SECRET="$(gen_secret 32)"
  ENCRYPTION_KEY="$(gen_secret 32)"

  cat > "${ENV_FILE}" <<EOF
POSTGRES_USER=${POSTGRES_USER}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_DB=${POSTGRES_DB}
POSTGRES_PORT=${POSTGRES_PORT}
NEXTAUTH_SECRET=${NEXTAUTH_SECRET}
API_KEY_SECRET=${API_KEY_SECRET}
ENCRYPTION_KEY=${ENCRYPTION_KEY}
NEXTAUTH_URL=${DEMO_URL}
NEXT_PUBLIC_APP_URL=${DEMO_URL}
APP_HOST_ALIASES=${DEMO_HOST},localhost:3000,127.0.0.1:3000
TRUST_PROXY_HEADERS=true
REDIRECT_TO_CANONICAL_HOST=false
ALLOW_INSECURE_SECRETS=false
NOTIFICATION_CONTROL_PLANE_PERSONAL=true
DEMO_MODE=true
EOF
else
  # Update dynamic forwarded host in existing .env if Codespaces resumed
  sed -i.bak -e "s|^NEXTAUTH_URL=.*|NEXTAUTH_URL=${DEMO_URL}|" \
             -e "s|^NEXT_PUBLIC_APP_URL=.*|NEXT_PUBLIC_APP_URL=${DEMO_URL}|" \
             -e "s|^APP_HOST_ALIASES=.*|APP_HOST_ALIASES=${DEMO_HOST},localhost:3000,127.0.0.1:3000|" "${ENV_FILE}" 2>/dev/null || true
  rm -f "${ENV_FILE}.bak"
fi

# Export variables for compose and tooling
while IFS='=' read -r key val || [ -n "$key" ]; do
  [[ "$key" =~ ^[[:space:]]*# ]] && continue
  [ -z "$key" ] && continue
  key="$(echo -n "$key" | xargs)"
  val="$(echo -n "$val" | xargs)"
  export "$key"="$val"
done < "${ENV_FILE}"

export COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.yml"
export COMPOSE_PROJECT_NAME="opsknight-demo"

# 3. Start database
echo "🐘 Starting PostgreSQL container..."
docker compose -p opsknight-demo -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" up -d opsknight-db

# 4. Wait for database readiness
echo "⏳ Waiting for PostgreSQL readiness..."
DB_READY=false
for i in {1..30}; do
  if docker compose -p opsknight-demo -f "${COMPOSE_FILE}" exec -T opsknight-db pg_isready -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null 2>&1; then
    DB_READY=true
    break
  fi
  sleep 1
done

if [ "$DB_READY" != "true" ]; then
  echo "❌ PostgreSQL did not become ready within 30 seconds."
  docker compose -p opsknight-demo -f "${COMPOSE_FILE}" logs opsknight-db
  exit 1
fi
echo "✅ Database is ready."

# 5. Start application
echo "🚀 Starting OpsKnight container..."
docker compose -p opsknight-demo -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" up -d opsknight-app

# 6. Wait for application HTTP readiness
echo "⏳ Waiting for OpsKnight application to be healthy..."
APP_READY=false
for i in {1..60}; do
  # Check if port 3000 responds to /api/health
  if curl -sf http://localhost:3000/api/health >/dev/null 2>&1; then
    APP_READY=true
    break
  fi
  sleep 2
done

if [ "$APP_READY" != "true" ]; then
  echo "⚠️  Application health endpoint pending, checking container status..."
  if ! docker compose -p opsknight-demo -f "${COMPOSE_FILE}" ps opsknight-app | grep -q "Up"; then
    echo "❌ OpsKnight container failed to start."
    docker compose -p opsknight-demo -f "${COMPOSE_FILE}" logs opsknight-app
    exit 1
  fi
fi
echo "✅ OpsKnight is up."

# 7. Seed demo dataset
bash "${SCRIPT_DIR}/seed-demo.sh"

# 8. Run automated verification smoke test
node "${SCRIPT_DIR}/verify-demo.mjs"

# 9. Start background 60-minute expiry watchdog
nohup bash "${SCRIPT_DIR}/expire-demo.sh" >/dev/null 2>&1 &
disown || true

# 10. Display formatted terminal card
cat << 'EOF'

╔═════════════════════════════════════════════════════════════════════════════╗
║                                                                             ║
║                     🛡️  OpsKnight Browser Demo Ready                        ║
║                                                                             ║
╠═════════════════════════════════════════════════════════════════════════════╣
║                                                                             ║
EOF
printf "║  🌐 Web Interface:  %-54s  ║\n" "${DEMO_URL}"
cat << 'EOF'
║  🔑 Email:          demo@opsknight.local                                    ║
║  🔒 Password:       OpsKnightDemo!                                          ║
║  👑 Role:           Admin (Platform Engineering)                            ║
║                                                                             ║
║  📌 Preloaded Showcase Scenarios:                                           ║
║     • Incidents:    P1 checkout outage, P2 latency spike, snoozed window    ║
║     • Services:     Gold, Silver, Bronze SLA tiers across 3 regions         ║
║     • On-Call:      Primary/Secondary rotations & active coverage handoff   ║
║     • Status Pages: /status (mixed) · /status/healthy · /status/degraded    ║
║     • Analytics:    MTTA/MTTR rollups, SLA performance, 5-Whys postmortems  ║
║                                                                             ║
║  ⏳ Auto-Expiry:    Ephemeral stack will auto-destroy in 60 minutes.        ║
║     To re-seed:     bash deploy/demo/seed-demo.sh                           ║
║     To stop now:    bash deploy/demo/expire-demo.sh --now                   ║
╚═════════════════════════════════════════════════════════════════════════════╝

EOF
