const { PrismaClient } = require('@prisma/client');
const { resolveDatabaseUrl } = require('./db-connection-resolver.cjs');

const rawDatabaseUrl =
  resolveDatabaseUrl({ preferDirect: true }) || process.env.DATABASE_URL;
if (!rawDatabaseUrl) {
  console.error('DATABASE_URL or DIRECT_DATABASE_URL is required to install online indexes.');
  process.exit(1);
}

const databaseUrl = new URL(rawDatabaseUrl);
databaseUrl.searchParams.set('connection_limit', '1');
const prisma = new PrismaClient({ datasourceUrl: databaseUrl.toString() });
const LOCK_ID = 1762184301;

async function main() {
  await prisma.$queryRawUnsafe(`SELECT pg_advisory_lock(${LOCK_ID})::text AS "lockResult"`);
  try {
    const existing = await prisma.$queryRawUnsafe(`
      SELECT i.indisvalid AS valid
      FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
      WHERE c.relname = 'idx_incident_next_sla_transition'
    `);
    if (existing[0] && !existing[0].valid) {
      await prisma.$executeRawUnsafe(`
        DROP INDEX CONCURRENTLY IF EXISTS "idx_incident_next_sla_transition"
      `);
    }
    await prisma.$executeRawUnsafe(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_incident_next_sla_transition"
      ON "Incident" ("status", "nextSlaTransitionAt")
    `);
    const rows = await prisma.$queryRawUnsafe(`
      SELECT i.indisvalid AS valid
      FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
      WHERE c.relname = 'idx_incident_next_sla_transition'
    `);
    if (!rows[0]?.valid) throw new Error('SLA scheduler index is missing or invalid.');
  } finally {
    await prisma.$queryRawUnsafe(`SELECT pg_advisory_unlock(${LOCK_ID})`);
  }
}

main()
  .catch(error => {
    console.error('SLA scheduler online index installation failed.', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
