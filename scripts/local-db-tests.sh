#!/usr/bin/env bash
# The database checks pull requests no longer run in CI (Actions volume): the same steps as the
# "Database integration", "Ingestion durability" and "Database secret operator scripts" jobs, run
# locally against a throwaway PostgreSQL database. Called by the pre-push hook; run it by hand with
#   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/opsknight_test bash scripts/local-db-tests.sh
# Every table in that database is truncated, so its name must end in _test.
set -euo pipefail

if [ -z "${TEST_DATABASE_URL:-}" ]; then
  echo "❌ Set TEST_DATABASE_URL to a throwaway PostgreSQL database whose name ends in _test, for example:"
  echo "   docker run -d --name opsknight-test-db -p 55432:5432 -e POSTGRES_PASSWORD=postgres postgres:16"
  echo "   export TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/opsknight_test"
  echo "   (SKIP_DB_TESTS=1 skips this step once; CI no longer runs it on pull requests.)"
  exit 1
fi
db_name="$(node -e 'console.log(new URL(process.argv[1]).pathname.slice(1))' "$TEST_DATABASE_URL")"
case "$db_name" in
  *_test) ;;
  *) echo "❌ Refusing to run: '$db_name' does not end in _test, and these tests truncate every table."; exit 1 ;;
esac

# The CI jobs' key, so encrypted fixtures behave the same locally.
export ENCRYPTION_KEY="${TEST_ENCRYPTION_KEY:-68112f544b2c8b0f84436ea34293f733c33e49b41e657b9db0275f5edf09c7ba}"
export NODE_ENV=test VITEST_USE_REAL_DB=1 DATABASE_URL="$TEST_DATABASE_URL"

# Creates a database on the same server if it is missing (args: url).
ensure_db() {
node -e '
const { Client } = require("pg");
const url = new URL(process.argv[1]); const name = url.pathname.slice(1); url.pathname = "/postgres";
const c = new Client({ connectionString: url.toString() });
c.connect()
  .then(() => c.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]))
  .then(r => (r.rowCount ? null : c.query(`CREATE DATABASE "${name}"`)))
  .then(() => c.end())
  .catch(e => { console.error("❌ Cannot reach PostgreSQL:", e.message); process.exit(1); });
' "$1"
}

echo "🗄️  Preparing $db_name (migrate, indexes, validation)..."
ensure_db "$TEST_DATABASE_URL"
npx prisma migrate deploy
npm run prisma:indexes:status-platform
npm run prisma:validate

echo "🔐 Authorization regression gate..."
npm run test:authorization

echo "🧪 Database integration tests (several minutes)..."
# Same exclusions as CI: these certification suites need their own enterprise_sso_test database.
npx vitest run -c vitest.int.config.ts --no-file-parallelism --maxWorkers=1 \
  --exclude tests/integration/authentication-policy-database.test.ts \
  --exclude tests/integration/emergency-authentication-database.test.ts \
  --exclude tests/integration/oidc-staged-authentication-database.test.ts \
  --exclude tests/integration/provider-feedback-isolation-database.test.ts \
  --exclude tests/integration/emergency-password-database.test.ts \
  --exclude tests/integration/oidc-linking-scale-database.test.ts \
  --exclude tests/integration/oidc-team-mapping-database.test.ts

# Same server, the database name each certification insists on (as in CI).
url_for() { node -e 'const u = new URL(process.argv[1]); u.pathname = "/" + process.argv[2]; u.search = process.argv[3] || ""; console.log(u.toString())' "$@"; }

SECRET_URL="$(url_for "$TEST_DATABASE_URL" pr847_test '?schema=public')"
echo "🧪 Database secret operator scripts (pr847_test)..."
ensure_db "$SECRET_URL"
DATABASE_URL="$SECRET_URL" npx prisma migrate deploy
DATABASE_URL="$SECRET_URL" DB_SECRET_SCRIPTS_CERTIFICATION=1 npx vitest run --no-file-parallelism \
  --maxWorkers=1 tests/integration/db-secret-scripts.test.ts

# Ingestion certification insists on its own localhost database named ingestion_test_*, as in CI.
INGESTION_URL="$(url_for "$TEST_DATABASE_URL" ingestion_test_local '?connection_limit=5')"
echo "🧪 Ingestion durability (ingestion_test_local)..."
ensure_db "$INGESTION_URL"
DATABASE_URL="$INGESTION_URL" npx prisma migrate deploy
DATABASE_URL="$INGESTION_URL" npx vitest run --config vitest.ingestion.config.ts

# Integration runs rewrite these generated reports; never push them by accident.
git checkout -- plans/ docs/automation/load-results.json 2>/dev/null || true
echo "✅ Database checks passed."
