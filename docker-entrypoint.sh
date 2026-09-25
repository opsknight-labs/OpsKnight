#!/bin/sh
set -e

echo "🚀 OpsKnight Startup"
echo "======================"

# If PgBouncer is enabled and raw credentials are provided without an encoded WEB_DATABASE_URL,
# safely construct an encoded WEB_DATABASE_URL to protect against passwords with special characters (@, :, /, ?, #, %).
if [ "${PGBOUNCER_ENABLED:-}" = "true" ] && [ -n "${PGBOUNCER_DB_PASSWORD:-}" ] && [ -z "${WEB_DATABASE_URL:-}" ]; then
    ENCODED_USER=$(node -e 'console.log(encodeURIComponent(process.argv[1]))' "${PGBOUNCER_DB_USER:-${POSTGRES_USER:-opsknight}}")
    ENCODED_PASS=$(node -e 'console.log(encodeURIComponent(process.argv[1]))' "$PGBOUNCER_DB_PASSWORD")
    DB_NAME="${PGBOUNCER_DB_NAME:-${POSTGRES_DB:-opsknight_db}}"
    export WEB_DATABASE_URL="postgresql://${ENCODED_USER}:${ENCODED_PASS}@opsknight-pgbouncer:6432/${DB_NAME}?sslmode=disable&pgbouncer=true"
    DATABASE_URL="$WEB_DATABASE_URL"
fi

# Prisma Migrate and the packaged index installers must bypass transaction
# poolers such as PgBouncer. Preserve the runtime URL and temporarily promote
# the direct URL for every schema-management command.
RUNTIME_DATABASE_URL=${DATABASE_URL:-}
if [ -n "${DIRECT_DATABASE_URL:-}" ]; then
    export DATABASE_URL="$DIRECT_DATABASE_URL"
    echo "🔐 Using direct database connection for schema management"
fi

if [ "${OPSKNIGHT_SKIP_MIGRATIONS:-}" = "true" ] || [ "${SKIP_MIGRATIONS:-}" = "true" ]; then
    echo "⏭️  Skipping in-pod migrations (OPSKNIGHT_SKIP_MIGRATIONS=true)"
    if [ -n "${DIRECT_DATABASE_URL:-}" ]; then
        export DATABASE_URL="${WEB_DATABASE_URL:-$RUNTIME_DATABASE_URL}"
    fi
    echo "🚀 Starting application..."
    export NEXT_RUNTIME=nodejs
    exec node server.js
fi

echo "🔄 Running database migrations..."

run_migrations() {
    if [ -f "node_modules/prisma/build/index.js" ]; then
        node node_modules/prisma/build/index.js migrate deploy
        return $?
    fi

    echo "❌ Prisma migration runtime not found"
    return 1
}

install_status_platform_indexes() {
    if [ -f "scripts/create-status-platform-online-indexes.cjs" ]; then
        node scripts/create-status-platform-online-indexes.cjs
        return $?
    fi

    echo "❌ Status platform index installer not found"
    return 1
}

run_auto_recovery() {
    echo "🔧 Attempting migration recovery..."

    if [ -f "scripts/dist/scripts/auto-recover-migrations.js" ]; then
        node scripts/dist/scripts/auto-recover-migrations.js
    elif [ -f "scripts/auto-recover-migrations.ts" ] && [ -f "node_modules/.bin/ts-node" ]; then
        node --loader ts-node/esm scripts/auto-recover-migrations.ts
    else
        echo "ℹ️  No executable recovery script found"
    fi
}

MAX_RETRIES=3
RETRY_COUNT=0
MIGRATION_SUCCESS=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    RETRY_COUNT=$((RETRY_COUNT + 1))

    if run_migrations; then
        echo "✅ Migrations completed successfully"
        MIGRATION_SUCCESS=1
        break
    else
        EXIT_CODE=$?
        echo "⚠️  Migration attempt $RETRY_COUNT failed (exit code: $EXIT_CODE)"

        if [ $RETRY_COUNT -lt $MAX_RETRIES ]; then
            run_auto_recovery || true
            echo "⏳ Waiting 5s before retrying..."
            sleep 5
        fi
    fi
done

if [ $MIGRATION_SUCCESS -eq 0 ]; then
    echo "❌ All migration attempts failed. Refusing to start against an unknown database schema."
    exit 1
fi

echo "🔄 Enforcing status platform indexes..."
if ! install_status_platform_indexes; then
    echo "❌ Status platform index enforcement failed. Refusing to start without required indexes."
    exit 1
fi

echo "✅ Status platform indexes are ready."
echo "✅ Database is ready."

if [ -n "${DIRECT_DATABASE_URL:-}" ]; then
    export DATABASE_URL="$RUNTIME_DATABASE_URL"
fi

if [ "${OPSKNIGHT_MIGRATION_ONLY:-}" = "true" ]; then
    echo "🏁 Migrations and online indexes completed successfully (OPSKNIGHT_MIGRATION_ONLY=true)."
    exit 0
fi

echo "🚀 Starting application..."
export NEXT_RUNTIME=nodejs
exec node server.js
