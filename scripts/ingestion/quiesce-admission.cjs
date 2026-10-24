/* eslint-disable @typescript-eslint/no-require-imports -- Local CommonJS certification helper. */
const assert = require('node:assert/strict');

// Close admission only on the disposable HTTP fixture. Leave it closed until
// the owning topology is destroyed: reopening before web shutdown could let
// already-timed-out callers commit after the final ledger snapshot again.
module.exports = async function quiesceAdmission(options = {}) {
  const url = new URL(options.databaseUrl || process.env.DATABASE_URL);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
  assert.equal(url.port, '55445');
  assert.ok(
    url.pathname === '/ingestion_test_http' ||
      (url.pathname.startsWith('/ingestion_test_http_') &&
        /^[a-z0-9_]+$/.test(url.pathname.slice('/ingestion_test_http_'.length)))
  );
  const timeoutMs = options.timeoutMs ?? 60000;
  assert.ok(Number.isInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 120000);
  const createClient =
    options.createClient ||
    (datasourceUrl => {
      const { PrismaClient } = require('@prisma/client');
      return new PrismaClient({ datasourceUrl });
    });
  // One diagnostic connection fits within the topology's reserved capacity.
  const clientUrl = new URL(url);
  clientUrl.searchParams.set('connection_limit', '1');
  clientUrl.searchParams.set('connect_timeout', '5');
  clientUrl.searchParams.set('pool_timeout', '5');
  clientUrl.searchParams.set(
    'options',
    '-c statement_timeout=5000 -c lock_timeout=5000 -c jit=off'
  );
  const prisma = createClient(clientUrl.toString());
  try {
    const [identity] = await prisma.$queryRaw`SELECT current_database() AS database`;
    assert.equal(identity.database, url.pathname.slice(1), 'Fixture datasource mismatch');
    const started = performance.now();
    const row = await prisma.systemConfig.findUnique({ where: { key: 'ingestion_control' } });
    const value = row?.value ?? { revision: 0 };
    assert.ok(value && typeof value === 'object' && !Array.isArray(value));
    await prisma.systemConfig.upsert({
      where: { key: 'ingestion_control' },
      create: { key: 'ingestion_control', value: { ...value, paused: true } },
      update: { value: { ...value, paused: true } },
    });
    // Policy reads are uncached READ COMMITTED reads. Every transaction that
    // could have seen admission open began before this post-commit barrier.
    // A one-second conservative margin avoids timestamp precision rounding.
    const [clock] = await prisma.$queryRaw`
    SELECT clock_timestamp() + INTERVAL '1 second' AS barrier
  `;
    let polls = 0;
    while (performance.now() - started < timeoutMs) {
      const [activity] = await prisma.$queryRaw`
      SELECT COUNT(*)::int AS pending FROM pg_stat_activity
      WHERE datid = (SELECT oid FROM pg_database WHERE datname = current_database())
        AND pid <> pg_backend_pid() AND xact_start <= ${clock.barrier}
    `;
      polls++;
      if (activity.pending === 0)
        return {
          passed: true,
          elapsedMs: performance.now() - started,
          polls,
          scope:
            'Disposable HTTP fixture admission closed after offered load; pre-barrier database transactions settled before final reconciliation. Policy remains paused through topology cleanup. Not notification drain or HTTP timeout prevention.',
        };
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error('Fixture admission transactions did not settle before reconciliation deadline');
  } finally {
    await prisma.$disconnect();
  }
};
