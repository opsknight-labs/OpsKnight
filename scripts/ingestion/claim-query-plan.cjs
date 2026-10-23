/* eslint-disable @typescript-eslint/no-require-imports -- Local diagnostic executes the production TypeScript claim function. */
/* eslint-disable security/detect-non-literal-fs-filename -- The explicit evidence destination belongs to this local fixture run. */
require('./isolated-runtime.cjs');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { writeFileSync } = require('node:fs');
const prisma = require('../../src/lib/prisma').default;
const { claimPostgresEvents } = require('../../src/lib/ingestion/postgres');

function summarize(node) {
  return {
    node: node['Node Type'],
    relation: node['Relation Name'],
    index: node['Index Name'],
    actualRows: node['Actual Rows'],
    loops: node['Actual Loops'],
    rowsRemoved: node['Rows Removed by Filter'],
    sharedHit: node['Shared Hit Blocks'],
    sharedRead: node['Shared Read Blocks'],
    children: node.Plans?.map(summarize),
  };
}

async function main() {
  const url = new URL(process.env.DATABASE_URL);
  assert.equal(url.port, '55445');
  assert.ok(
    ['/ingestion_test_http_poolscale', '/ingestion_test_claim_plan'].includes(url.pathname)
  );
  assert.equal(process.env.OPSKNIGHT_INGESTION_MODE, 'postgres');
  const count = Number(process.env.INGESTION_PLAN_BACKLOG || 1000);
  assert.ok(Number.isInteger(count) && count >= 4 && count <= 100000);
  const [clients] = await prisma.$queryRaw`
    SELECT count(*)::int AS others FROM pg_stat_activity
    WHERE datname = current_database() AND pid <> pg_backend_pid()
      AND backend_type = 'client backend'`;
  assert.equal(clients.others, 0, 'Stop all other clients and consumers on the owned fixture');
  assert.equal(
    await prisma.ingestionReceipt.count({
      where: { status: { notIn: ['COMPLETED', 'ARCHIVED'] } },
    }),
    0,
    'Only an idle owned queue may be used for this rollback-only fixture'
  );
  let captured;
  prisma.$on('query', event => {
    if (event.query.includes('WITH critical AS')) captured = event;
  });
  assert.equal((await claimPostgresEvents(4)).length, 0);
  assert.ok(captured, 'Production claim SQL was not captured');
  const query = captured.query;
  const parameters = JSON.parse(captured.params);
  const retainedHistory = await prisma.ingestionReceipt.count();
  const indexes = await prisma.$queryRaw`
    SELECT i.indisvalid AS valid, i.indisready AS ready
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname = 'IngestionReceipt_claim_sequence_idx'
      AND c.relnamespace = current_schema()::regnamespace`;
  const rollback = new Error('Intentional diagnostic rollback');
  let result;
  try {
    await prisma.$transaction(
      async tx => {
        await tx.$executeRaw`LOCK TABLE "IngestionReceipt" IN ACCESS EXCLUSIVE MODE NOWAIT`;
        const prefix = randomUUID();
        const sequenceIndex = process.env.INGESTION_PLAN_SEQUENCE_INDEX === 'true';
        if (sequenceIndex) assert.equal(indexes.length, 0, 'Experimental index already installed');
        if (sequenceIndex)
          await tx.$executeRaw`CREATE INDEX "IngestionReceipt_claim_sequence_idx"
            ON "IngestionReceipt" ("sequence") WHERE "status" IN ('PENDING', 'PROCESSING')`;
        // Available timestamps deliberately precede the transaction clock: the
        // millisecond column can otherwise round a default timestamp into its future.
        await tx.$executeRaw`
        INSERT INTO "IngestionReceipt"
          (id, "serviceId", "integrationId", "partitionKey", "idempotencyKey", "contentHash",
           "budgetShard", "payloadBytes", envelope, "orderingKeys", critical, "availableAt")
        SELECT ${prefix} || g, 'owned-plan-service', 'owned-plan-integration', ${prefix} || g,
          ${prefix} || g, 'owned-plan-hash', 0, 1, '{}'::jsonb, ARRAY[${prefix} || g],
          g % 10 = 0, CURRENT_TIMESTAMP - INTERVAL '1 second'
        FROM generate_series(1, ${count}::int) g`;
        // SQL is captured from the production function, never supplied externally.
        const rows = await tx.$queryRawUnsafe(
          'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + query,
          ...parameters
        );
        const plan = rows[0]['QUERY PLAN'][0];
        assert.equal(
          plan.Plan['Actual Rows'],
          4,
          'Diagnostic must actually claim four eligible heads'
        );
        result = {
          recordedAt: new Date().toISOString(),
          scope:
            'Production claim SQL with unique-key synthetic backlog, 10% critical; fixture rows and claims rolled back atomically. No concurrent workers or durability/capacity certification.',
          queryFingerprint: createHash('sha256').update(query).digest('hex'),
          retainedHistory,
          installedSequenceIndex: indexes[0] ?? null,
          experimentalSequenceIndex: sequenceIndex,
          backlog: count,
          claimed: 4,
          executionMs: plan['Execution Time'],
          planningMs: plan['Planning Time'],
          plan: summarize(plan.Plan),
        };
        throw rollback;
      },
      { timeout: 60000 }
    );
  } catch (error) {
    if (error !== rollback) throw error;
  }
  assert.equal(await prisma.ingestionReceipt.count(), retainedHistory, 'Fixture rollback failed');
  writeFileSync(
    process.env.INGESTION_PLAN_EVIDENCE || 'plans/event-ingestion/local-claim-query-plan.json',
    JSON.stringify(result, null, 2) + '\n'
  );
  console.log(
    JSON.stringify({ backlog: count, claimed: result.claimed, executionMs: result.executionMs })
  );
}
main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
