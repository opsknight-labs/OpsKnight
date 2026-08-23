#!/bin/sh
set -e

echo "🚀 OpsKnight Startup"
echo "======================"

echo "🔄 Running database migrations..."

run_migrations() {
    if [ -f "node_modules/prisma/build/index.js" ]; then
        node node_modules/prisma/build/index.js migrate deploy
        return $?
    fi

    echo "❌ Prisma migration runtime not found"
    return 1
}

run_auto_recovery() {
    echo "🔧 Attempting migration recovery..."

    if [ -f "scripts/dist/auto-recover-migrations.js" ]; then
        node scripts/dist/auto-recover-migrations.js
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

echo "✅ Database is ready."
echo "🚀 Starting application..."
exec node server.js
