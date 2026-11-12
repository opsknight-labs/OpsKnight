#!/usr/bin/env node
/**
 * Repairs indexes left INVALID by an interrupted CONCURRENTLY build (a cancelled migration, a killed
 * pod, a statement timeout). An invalid index is never used by the planner but still costs every write,
 * and `CREATE INDEX CONCURRENTLY IF NOT EXISTS` skips it forever because the name exists. Each one is
 * rebuilt online with REINDEX CONCURRENTLY; leftovers of an interrupted rebuild (`_ccnew`/`_ccold`) are
 * dropped. Safe to run at every start: it does nothing when every index is valid.
 *
 *   node scripts/repair-invalid-indexes.cjs [--dry-run]
 */
const { PrismaClient } = require('@prisma/client');
const { resolveDatabaseUrl } = require('./db-connection-resolver.cjs');

const dryRun = process.argv.includes('--dry-run');
const rawDatabaseUrl = resolveDatabaseUrl({ preferDirect: true });
if (!rawDatabaseUrl) {
  console.error('DATABASE_URL or DIRECT_DATABASE_URL is required to repair indexes.');
  process.exit(1);
}
const databaseUrl = new URL(rawDatabaseUrl);
// REINDEX CONCURRENTLY and SET need the same backend; a one-connection pool guarantees that.
databaseUrl.searchParams.set('connection_limit', '1');
const prisma = new PrismaClient({ datasourceUrl: databaseUrl.toString() });

const LEFTOVER = /_cc(?:new|old)\d*$/;
const SAFE_NAME = /^[A-Za-z0-9_]+$/;

async function listInvalidIndexes() {
  return prisma.$queryRawUnsafe(`
    SELECT c.relname AS name, t.relname AS table
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE NOT i.indisvalid AND n.nspname = 'public'
    ORDER BY c.relname`);
}

async function main() {
  const invalid = await listInvalidIndexes();
  if (invalid.length === 0) {
    console.log('✅ No invalid indexes.');
    return;
  }
  for (const row of invalid) {
    if (!SAFE_NAME.test(row.name)) {
      console.warn(`⚠️  Skipping index with an unexpected name: ${JSON.stringify(row.name)}`);
      continue;
    }
    if (LEFTOVER.test(row.name)) {
      console.warn(`⚠️  Dropping leftover "${row.name}" from an interrupted concurrent rebuild`);
      if (!dryRun) await prisma.$executeRawUnsafe(`DROP INDEX CONCURRENTLY IF EXISTS "${row.name}"`);
      continue;
    }
    console.warn(`⚠️  Rebuilding invalid index "${row.name}" on "${row.table}" concurrently`);
    if (!dryRun) {
      await prisma.$executeRawUnsafe(`SET lock_timeout = '5s'`);
      await prisma.$executeRawUnsafe(`REINDEX INDEX CONCURRENTLY "${row.name}"`);
    }
  }
  if (dryRun) return;
  const remaining = await listInvalidIndexes();
  if (remaining.length > 0) {
    throw new Error(`Still invalid after repair: ${remaining.map(row => row.name).join(', ')}`);
  }
  console.log(`✅ Repaired ${invalid.length} invalid index(es).`);
}

main()
  .catch(error => {
    console.error('Invalid index repair failed.', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
