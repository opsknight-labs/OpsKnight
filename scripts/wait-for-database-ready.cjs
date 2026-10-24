/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CommonJS readiness gate packaged in the production image. */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const { pendingClassificationCount } = require('./backfill-automation-source-classification.cjs');

const REQUIRED_INDEXES = [
  'IngestionReceipt_claim_sequence_idx',
  'RuntimeWorkerHeartbeat_ingestion_healthy_idx',
  'idx_notification_tenant_fair_delivery',
  'StatusPageSubscription_statusPageId_state_idx',
  // The SLA scheduler index is optional in LEGACY/SHADOW and is guarded when enabling INDEXED.
  'idx_attempt_open_voice',
  'idx_attempt_provider_msg_id',
  'UserDevice_diagnostic_activity_idx',
  'UserDevice_diagnostic_created_idx',
  'UserDevice_diagnostic_expiry_idx',
  'UserDevice_diagnostic_projection_pending_idx',
  'EmergencyAccessEvent_page_idx',
  'EmergencyAccessEvent_type_page_idx',
  'EmergencyAccessEvent_outcome_page_idx',
  'AuthenticationReplicaObservation_page_idx',
];

const migrationsDir = path.join(__dirname, '..', 'prisma', 'migrations');
const timeoutMs = Number(process.env.OPSKNIGHT_DATABASE_READY_TIMEOUT_MS || 900_000);
const pollMs = Number(process.env.OPSKNIGHT_DATABASE_READY_POLL_MS || 2_000);

function localMigrations() {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed packaged migration directory resolved from this script.
  const entries = fs.readdirSync(migrationsDir, { withFileTypes: true });
  return entries
    .filter(entry => entry.isDirectory() && /^\d{14}_/.test(entry.name))
    .map(entry => entry.name);
}

async function readinessProblem(prisma, expectedMigrations) {
  const migrations = await prisma.$queryRawUnsafe(`
    SELECT migration_name, finished_at, rolled_back_at
    FROM "_prisma_migrations"
  `);
  const completed = new Set(
    migrations
      .filter(row => row.finished_at !== null && row.rolled_back_at === null)
      .map(row => row.migration_name)
  );
  const pending = expectedMigrations.filter(name => !completed.has(name));
  if (pending.length > 0) return `${pending.length} migration(s) are not complete`;

  const indexes = await prisma.$queryRawUnsafe(
    `SELECT c.relname AS name, i.indisvalid AS valid
     FROM pg_index i
     JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname = ANY($1::text[]) AND c.relnamespace = current_schema()::regnamespace`,
    REQUIRED_INDEXES
  );
  const validIndexes = new Set(indexes.filter(row => row.valid).map(row => row.name));
  const missingIndexes = REQUIRED_INDEXES.filter(name => !validIndexes.has(name));
  if (missingIndexes.length > 0) {
    return `required indexes are missing or invalid: ${missingIndexes.join(', ')}`;
  }

  const unclassified = await pendingClassificationCount(prisma);
  if (unclassified > 0) return `${unclassified} incident(s) await automation source classification`;

  const [projection] = await prisma.$queryRawUnsafe(`SELECT EXISTS (
    SELECT 1 FROM "UserDevice" WHERE "deviceId" LIKE 'session:%' AND "sessionDiagnosticProjectedAt" IS NULL
  ) AS pending`);
  if (projection.pending) return 'authentication diagnostic projection is not complete';
  return null;
}

async function main() {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(pollMs) || pollMs <= 0) {
    throw new Error('Database readiness timeout and poll intervals must be positive numbers.');
  }

  const { resolveDatabaseUrl } = require('./db-connection-resolver.cjs');
  const directUrl = resolveDatabaseUrl({ preferDirect: true });
  if (!directUrl) throw new Error('DATABASE_URL or DIRECT_DATABASE_URL is required.');

  const prisma = new PrismaClient({ datasourceUrl: directUrl });
  const expectedMigrations = localMigrations();
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;

  try {
    while (Date.now() < deadline) {
      attempt += 1;
      try {
        const problem = await readinessProblem(prisma, expectedMigrations);
        if (!problem) {
          console.log('Database migrations and required online indexes are ready.');
          return;
        }
        if (attempt === 1 || attempt % 15 === 0) console.log(`Waiting for database: ${problem}.`);
      } catch (error) {
        if (attempt === 1 || attempt % 15 === 0) {
          console.log(
            `Waiting for database: ${error instanceof Error ? error.message : String(error)}.`
          );
        }
      }
      await new Promise(resolve => setTimeout(resolve, pollMs));
    }
  } finally {
    await prisma.$disconnect();
  }

  throw new Error(`Database did not become ready within ${timeoutMs}ms.`);
}

if (require.main === module) {
  main().catch(error => {
    console.error('Database readiness gate failed.', error);
    process.exitCode = 1;
  });
}

module.exports = { REQUIRED_INDEXES, readinessProblem };
