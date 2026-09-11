const { PrismaClient } = require('@prisma/client');

const databaseUrl = new URL(process.env.DATABASE_URL);
// Session-level advisory locks require every statement to use the same backend.
// A dedicated one-connection Prisma pool provides that guarantee during startup.
databaseUrl.searchParams.set('connection_limit', '1');

const prisma = new PrismaClient({
  datasourceUrl: databaseUrl.toString(),
});

const INSTALL_LOCK_ID = 1448233807;
const MAX_INSTALL_ATTEMPTS = 5;

const indexes = [
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_notification_tenant_fair_delivery"
   ON "Notification"("trafficClass", "tenantKey", "status", "nextAttemptAt", "createdAt")`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "StatusPageSubscription_statusPageId_state_idx"
   ON "StatusPageSubscription"("statusPageId", "state")`,
];

const requiredIndexNames = [
  'idx_notification_tenant_fair_delivery',
  'StatusPageSubscription_statusPageId_state_idx',
];

async function assertRequiredIndexes() {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT c.relname AS name, i.indisvalid AS valid
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname = ANY(ARRAY[${requiredIndexNames
      .map(name => `'${name}'`)
      .join(',')}])
  `);
  const valid = new Set(rows.filter(row => row.valid).map(row => row.name));
  const missing = requiredIndexNames.filter(name => !valid.has(name));
  if (missing.length > 0) {
    throw new Error(
      `Status platform online indexes are missing or invalid: ${missing.join(', ')}. ` +
        'Run npm run prisma:indexes:status-platform before starting notification workers.'
    );
  }
}

async function main() {
  for (let attempt = 1; attempt <= MAX_INSTALL_ATTEMPTS; attempt += 1) {
    let lockAcquired = false;
    try {
      // Cast PostgreSQL's void result so Prisma can deserialize the row.
      await prisma.$queryRawUnsafe(
        `SELECT pg_advisory_lock(${INSTALL_LOCK_ID})::text AS "lockResult"`
      );
      lockAcquired = true;

      for (const statement of indexes) {
        await prisma.$executeRawUnsafe(statement);
      }
      await assertRequiredIndexes();
      return;
    } catch (error) {
      const code = error?.code || error?.meta?.code;
      // Multiple new replicas can race immediately after a deployment. PostgreSQL can choose one
      // waiter as a deadlock victim while a concurrent index build waits for its transaction to
      // finish. The index statements are idempotent, so retrying from a fresh session is safe.
      if ((code !== '40P01' && code !== '55P03') || attempt === MAX_INSTALL_ATTEMPTS) throw error;
      const delayMs = attempt * 1_000;
      console.warn(
        `Status platform index installer contention on attempt ${attempt}; retrying in ${delayMs}ms.`
      );
      await new Promise(resolve => setTimeout(resolve, delayMs));
    } finally {
      if (lockAcquired) {
        await prisma.$queryRawUnsafe(`SELECT pg_advisory_unlock(${INSTALL_LOCK_ID})`);
      }
    }
  }
}

main()
  .catch(error => {
    console.error('Status platform online index installation failed.', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
