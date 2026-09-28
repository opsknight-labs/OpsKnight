/**
 * Online index installer for voice paging delivery attempt indexes.
 *
 * Creates two partial indexes on NotificationDeliveryAttempt that cannot be
 * included in a Prisma migration file because PostgreSQL rejects
 * CREATE INDEX CONCURRENTLY inside a transaction block.
 *
 * Indexes created:
 *
 *   idx_attempt_open_voice
 *     (notificationId, outcome) WHERE finishedAt IS NULL
 *     Speeds up the voice reconciler's sub-query that finds notifications with
 *     at least one open (non-terminal) delivery attempt, keeping the scan
 *     O(open-attempts) rather than O(all-attempts).
 *
 *   idx_attempt_provider_msg_id
 *     (providerMessageId) WHERE providerMessageId IS NOT NULL
 *     Speeds up the Twilio status-route point lookup by Call SID stored on
 *     the attempt row (distinct from the notification-level providerMessageId).
 *
 * This script is idempotent: it drops any existing invalid (failed) index build
 * before re-creating, verifies the result, and exits non-zero on failure so that
 * deployment pipelines surface index installation errors.
 *
 * Advisory lock (LOCK_ID 1762184302) prevents concurrent index creation across
 * multiple replicas or CI workers starting simultaneously.
 */

'use strict';

const { PrismaClient } = require('@prisma/client');

const databaseUrl = new URL(process.env.DATABASE_URL);
databaseUrl.searchParams.set('connection_limit', '1');
const prisma = new PrismaClient({ datasourceUrl: databaseUrl.toString() });
const LOCK_ID = 1762184302;

async function ensureIndex(name, ddl) {
  // Drop any previously failed (invalid) build of this index before retrying.
  const existing = await prisma.$queryRawUnsafe(`
    SELECT i.indisvalid AS valid
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname = $1
  `, name);

  if (existing[0] && !existing[0].valid) {
    console.log(`⚠️  Dropping invalid index build: ${name}`);
    await prisma.$executeRawUnsafe(`DROP INDEX CONCURRENTLY IF EXISTS "${name}"`);
  }

  await prisma.$executeRawUnsafe(ddl);

  const rows = await prisma.$queryRawUnsafe(`
    SELECT i.indisvalid AS valid
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname = $1
  `, name);

  if (!rows[0]?.valid) {
    throw new Error(`Voice attempt online index is missing or invalid: ${name}`);
  }

  console.log(`✅ Index ready: ${name}`);
}

async function main() {
  await prisma.$queryRawUnsafe(`SELECT pg_advisory_lock(${LOCK_ID})::text AS "lockResult"`);
  try {
    await ensureIndex(
      'idx_attempt_open_voice',
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_attempt_open_voice"
       ON "NotificationDeliveryAttempt" ("notificationId", "outcome")
       WHERE "finishedAt" IS NULL`
    );

    await ensureIndex(
      'idx_attempt_provider_msg_id',
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_attempt_provider_msg_id"
       ON "NotificationDeliveryAttempt" ("providerMessageId")
       WHERE "providerMessageId" IS NOT NULL`
    );
  } finally {
    await prisma.$queryRawUnsafe(`SELECT pg_advisory_unlock(${LOCK_ID})`);
  }
}

main()
  .catch(error => {
    console.error('Voice attempt online index installation failed.', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
