/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CommonJS installer packaged in the production image. */
// Online diagnostic indexes and resumable historical projection; use a direct PostgreSQL connection.
'use strict';

const { PrismaClient } = require('@prisma/client');

const databaseUrl = new URL(process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL);
databaseUrl.searchParams.set('connection_limit', '1');
const prisma = new PrismaClient({ datasourceUrl: databaseUrl.toString() });
const LOCK_ID = 1762184303;

async function ensureIndex(name, ddl) {
  // Drop any previously failed (invalid) build of this index before retrying.
  const existing = await prisma.$queryRawUnsafe(
    `
    SELECT i.indisvalid AS valid
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname = $1 AND c.relnamespace = current_schema()::regnamespace
  `,
    name
  );

  if (existing[0] && !existing[0].valid) {
    console.log(`⚠️  Dropping invalid index build: ${name}`);
    await prisma.$executeRawUnsafe(`DROP INDEX CONCURRENTLY IF EXISTS "${name}"`);
  }

  await prisma.$executeRawUnsafe(ddl);

  const rows = await prisma.$queryRawUnsafe(
    `
    SELECT i.indisvalid AS valid
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname = $1 AND c.relnamespace = current_schema()::regnamespace
  `,
    name
  );

  if (!rows[0]?.valid) {
    throw new Error(`Authentication diagnostics online index is missing or invalid: ${name}`);
  }

  console.log(`✅ Index ready: ${name}`);
}

async function backfill() {
  await prisma.$executeRawUnsafe(String.raw`CREATE OR REPLACE FUNCTION pg_temp.auth_diagnostic_version(metadata TEXT) RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE value JSONB; version NUMERIC;
BEGIN
  value := metadata::jsonb;
  IF NOT value ? 'issuedUnderPolicyVersion' OR value->'issuedUnderPolicyVersion' = 'null'::jsonb THEN RETURN NULL; END IF;
  IF jsonb_typeof(value->'issuedUnderPolicyVersion') <> 'number' THEN RETURN -1; END IF;
  version := (value->>'issuedUnderPolicyVersion')::numeric;
  IF version <> trunc(version) OR version < 1 OR version > 2147483647 THEN RETURN -1; END IF;
  RETURN version::integer;
EXCEPTION WHEN OTHERS THEN RETURN -1;
END;
$$;`);
  await prisma.$executeRawUnsafe(String.raw`-- Earlier session expiry was nullable; safely project valid historical ISO timestamps.
CREATE OR REPLACE FUNCTION pg_temp.auth_diagnostic_expiry(metadata TEXT) RETURNS TIMESTAMP(3) LANGUAGE plpgsql AS $$
DECLARE value TEXT;
BEGIN
  value := metadata::jsonb->>'expiresAt';
  IF value IS NULL OR value !~ '^\d{4}-\d{2}-\d{2}T' THEN RETURN NULL; END IF;
  RETURN (value::timestamptz AT TIME ZONE 'UTC');
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END;
$$;`);
  let total = 0;
  const timeoutMs = Number(process.env.AUTH_DIAGNOSTIC_DEADLINE_MS) || 15 * 60 * 1000;
  const deadline = Date.now() + timeoutMs;
  let pass = 0;
  let delayMs = 250;
  let cancelled = false;
  const onSignal = () => {
    cancelled = true;
  };
  process.once('SIGTERM', onSignal);
  process.once('SIGINT', onSignal);
  try {
    while (true) {
      if (cancelled) throw new Error('Diagnostic backfill was cancelled.');
      if (Date.now() >= deadline) {
        throw new Error(
          'Historical session projection is incomplete after bounded reconciliation; readiness remains blocked. Retry after contention subsides.'
        );
      }
      pass++;
      let after = '';
      while (true) {
        if (cancelled) throw new Error('Diagnostic backfill was cancelled.');
        if (Date.now() >= deadline)
          throw new Error('Diagnostic backfill deadline exceeded; readiness remains blocked.');
        const rows = await prisma.$transaction(
          async tx => {
            await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '250ms'");
            await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '2s'");
            return tx.$queryRawUnsafe(
              `WITH batch AS (
            SELECT id FROM "UserDevice" WHERE id > $1 AND "deviceId" LIKE 'session:%'
              AND "sessionDiagnosticProjectedAt" IS NULL
            ORDER BY id LIMIT 250 FOR UPDATE SKIP LOCKED
          ) UPDATE "UserDevice" d SET
            "sessionPolicyVersion" = COALESCE(d."sessionPolicyVersion", pg_temp.auth_diagnostic_version(d.token)),
            "sessionExpiresAt" = COALESCE(d."sessionExpiresAt", pg_temp.auth_diagnostic_expiry(d.token)),
            "sessionDiagnosticProjectedAt" = CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
          FROM batch WHERE d.id = batch.id RETURNING d.id`,
              after
            );
          },
          { timeout: 5000 }
        );
        if (!rows.length) break;
        after = rows
          .map(row => row.id)
          .sort()
          .at(-1);
        total += rows.length;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      const [remaining] = await prisma.$queryRawUnsafe(`SELECT EXISTS (
        SELECT 1 FROM "UserDevice" WHERE "deviceId" LIKE 'session:%' AND "sessionDiagnosticProjectedAt" IS NULL
      ) AS pending`);
      if (!remaining.pending) {
        console.log(
          `Authentication diagnostic projection complete: ${total} rows processed across ${pass} pass(es).`
        );
        return;
      }
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        throw new Error(
          'Historical session projection is incomplete after bounded reconciliation; readiness remains blocked. Retry after contention subsides.'
        );
      }
      const waitTime = Math.min(delayMs, remainingMs);
      console.log(
        `Historical sessions remain locked or were added during preparation; reconciling (pass ${pass}, retrying in ${waitTime}ms, ${Math.ceil(remainingMs / 1000)}s remaining).`
      );
      await new Promise(resolve => setTimeout(resolve, waitTime));
      delayMs = Math.min(Math.round(delayMs * 1.5), 2000);
    }
  } finally {
    process.removeListener('SIGTERM', onSignal);
    process.removeListener('SIGINT', onSignal);
  }
}

async function main() {
  await prisma.$executeRawUnsafe("SET lock_timeout = '5s'");
  await prisma.$executeRawUnsafe("SET statement_timeout = '30min'");
  await prisma.$queryRawUnsafe(`SELECT pg_advisory_lock(${LOCK_ID})::text AS "lockResult"`);
  try {
    await ensureIndex(
      'UserDevice_diagnostic_activity_idx',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "UserDevice_diagnostic_activity_idx" ON "UserDevice" ("lastUsed",id)'
    );
    await ensureIndex(
      'UserDevice_diagnostic_created_idx',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "UserDevice_diagnostic_created_idx" ON "UserDevice" ("createdAt",id)'
    );
    await ensureIndex(
      'UserDevice_diagnostic_expiry_idx',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "UserDevice_diagnostic_expiry_idx" ON "UserDevice" ("sessionExpiresAt",id)'
    );
    await ensureIndex(
      'EmergencyAccessEvent_page_idx',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "EmergencyAccessEvent_page_idx" ON "EmergencyAccessEvent" ("createdAt",id)'
    );
    await ensureIndex(
      'EmergencyAccessEvent_type_page_idx',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "EmergencyAccessEvent_type_page_idx" ON "EmergencyAccessEvent" ("eventType","createdAt",id)'
    );
    await ensureIndex(
      'EmergencyAccessEvent_outcome_page_idx',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "EmergencyAccessEvent_outcome_page_idx" ON "EmergencyAccessEvent" (outcome,"createdAt",id)'
    );
    await ensureIndex(
      'AuthenticationReplicaObservation_page_idx',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "AuthenticationReplicaObservation_page_idx" ON "AuthenticationReplicaObservation" ("lastSeenAt",id)'
    );
    await ensureIndex(
      'UserDevice_diagnostic_projection_pending_idx',
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS "UserDevice_diagnostic_projection_pending_idx"
       ON "UserDevice" (id) WHERE "deviceId" LIKE 'session:%' AND "sessionDiagnosticProjectedAt" IS NULL`
    );
    await backfill();
  } finally {
    await prisma.$queryRawUnsafe(`SELECT pg_advisory_unlock(${LOCK_ID})`);
  }
}

main()
  .catch(error => {
    console.error('Authentication diagnostics preparation failed.', error.code || error.name);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
