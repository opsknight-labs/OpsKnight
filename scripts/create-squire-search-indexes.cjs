#!/usr/bin/env node
/**
 * Trigram indexes for the assistant's name and title matching (incident search by keyword, fuzzy service
 * names). Built online with CREATE INDEX CONCURRENTLY and only when the pg_trgm extension is installed; an
 * install without the extension keeps working with plain substring matching. Safe to run at every start.
 *
 *   node scripts/create-squire-search-indexes.cjs
 */
const { PrismaClient } = require('@prisma/client');
const { resolveDatabaseUrl } = require('./db-connection-resolver.cjs');

const rawDatabaseUrl = resolveDatabaseUrl({ preferDirect: true });
if (!rawDatabaseUrl) {
  console.error('DATABASE_URL or DIRECT_DATABASE_URL is required to install search indexes.');
  process.exit(1);
}
const databaseUrl = new URL(rawDatabaseUrl);
databaseUrl.searchParams.set('connection_limit', '1');
const prisma = new PrismaClient({ datasourceUrl: databaseUrl.toString() });

const INDEXES = [
  {
    name: 'idx_incident_title_trgm',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_incident_title_trgm" ON "Incident" USING gin (lower("title") gin_trgm_ops)`,
  },
  {
    name: 'idx_service_name_trgm',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_service_name_trgm" ON "Service" USING gin (lower("name") gin_trgm_ops)`,
  },
];

async function main() {
  const [{ installed }] = await prisma.$queryRawUnsafe(
    `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') AS installed`
  );
  if (!installed) {
    console.log('ℹ️  pg_trgm is not installed; assistant search keeps using substring matching.');
    return;
  }
  const invalid = await prisma.$queryRawUnsafe(`
    SELECT c.relname AS name FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE NOT i.indisvalid AND c.relname = ANY(ARRAY[${INDEXES.map(index => `'${index.name}'`).join(',')}])`);
  for (const row of invalid) {
    console.warn(`⚠️  Dropping invalid index ${row.name} from an interrupted build`);
    await prisma.$executeRawUnsafe(`DROP INDEX CONCURRENTLY IF EXISTS "${row.name}"`);
  }
  await prisma.$executeRawUnsafe(`SET lock_timeout = '5s'`);
  for (const index of INDEXES) await prisma.$executeRawUnsafe(index.sql);
  console.log('✅ Assistant search indexes are ready.');
}

main()
  .catch(error => {
    console.error('Assistant search index installation failed.', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
