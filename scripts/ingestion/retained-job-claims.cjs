/* eslint-disable @typescript-eslint/no-require-imports -- Owned PostgreSQL diagnostic uses the shared TypeScript runtime. */
/* eslint-disable security/detect-non-literal-fs-filename -- Operator-selected local evidence artifact. */
require('./isolated-runtime.cjs');
const assert = require('node:assert/strict');
const { writeFileSync } = require('node:fs');
const prisma = require('../../src/lib/prisma').default;
const {
  claimPendingOperationalJobs,
  GENERAL_WORKER_EXCLUDED_JOB_TYPES,
} = require('../../src/lib/jobs/queue');
const { boundedPlan } = require('./query-plan-summary.cjs');

(async () => {
  const url = new URL(process.env.DATABASE_URL);
  assert.equal(url.port, '55445');
  assert.ok(
    url.pathname.startsWith('/ingestion_test_job_history'),
    'Dedicated empty history fixture required'
  );
  assert.equal(await prisma.backgroundJob.count(), 0);
  const history = Number(process.env.INGESTION_JOB_HISTORY || 1000000);
  assert.ok(Number.isSafeInteger(history) && history >= 1000 && history <= 1000000);
  await prisma.$executeRaw`
    INSERT INTO "BackgroundJob" (id,type,status,"scheduledAt",payload,"createdAt","updatedAt","completedAt")
    SELECT 'owned-history-' || g, 'SCHEDULED_TASK'::"JobType", 'COMPLETED'::"JobStatus",
      clock_timestamp()-INTERVAL '1 day', jsonb_build_object('task','EVENT_SIDE_EFFECT',
        'effect','TRIGGER_WEBHOOK','lane','WEBHOOK','incidentId','owned-history-' || g,
        'eventOrderAt','2026-01-01T00:00:00.000Z','sourceEventId','owned-history'),
      clock_timestamp()-INTERVAL '1 day',clock_timestamp(),clock_timestamp()
    FROM generate_series(1,${history}::int) g
  `;
  await prisma.$executeRaw`
    INSERT INTO "BackgroundJob" (id,type,status,"scheduledAt",payload,"createdAt","updatedAt")
    SELECT 'owned-active-' || g, 'SCHEDULED_TASK'::"JobType", 'PENDING_V2'::"JobStatus",
      clock_timestamp()-INTERVAL '1 minute', jsonb_build_object('task','EVENT_SIDE_EFFECT',
        'effect','DISPATCH_ORDINARY','lane','ORDINARY_DISPATCH','incidentId','owned-active-' || g,
        'eventOrderAt','2026-01-01T00:00:00.000Z','sourceEventId','owned-active',
        'dispatch',jsonb_build_object('version',1,'effects',jsonb_build_array('TRIGGER_WEBHOOK'))),
      clock_timestamp()-INTERVAL '1 minute',clock_timestamp()
    FROM generate_series(1,100) g
  `;
  await prisma.$executeRaw`ANALYZE "BackgroundJob"`;
  const statements = [];
  const original = prisma.$queryRaw;
  prisma.$queryRaw = async statement => {
    statements.push(statement);
    return [];
  };
  try {
    await claimPendingOperationalJobs(100, GENERAL_WORKER_EXCLUDED_JOB_TYPES, {
      excludeCriticalEffects: true,
    });
  } finally {
    prisma.$queryRaw = original;
  }
  const ordinary = statements.filter(statement =>
    statement.text?.includes("IS NOT DISTINCT FROM 'AUTOMATION_OBSERVE'")
  );
  assert.equal(
    ordinary.length,
    1,
    'Capture exactly the ordinary claim, not the reserved observation slice'
  );
  const claim = ordinary[0];
  assert.equal(claim.values.at(-1), 100, 'Ordinary claim must request the full ready fixture');
  const rollback = new Error('Owned claim diagnostic rollback');
  const repeats = [];
  for (let repeat = 0; repeat < 4; repeat++) {
    try {
      await prisma.$transaction(
        async tx => {
          const rows = await tx.$queryRawUnsafe(
            'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + claim.text,
            ...claim.values
          );
          const value = rows[0]['QUERY PLAN'][0];
          assert.equal(
            await tx.backgroundJob.count({ where: { status: 'PROCESSING_V2' } }),
            100,
            'Measured claim must actually claim every ready parent'
          );
          repeats.push({
            executionMs: value['Execution Time'],
            planningMs: value['Planning Time'],
            plan: boundedPlan(value.Plan),
          });
          throw rollback;
        },
        { timeout: 30000 }
      );
    } catch (error) {
      if (error !== rollback) throw error;
    }
  }
  assert.equal(await prisma.backgroundJob.count({ where: { status: 'PENDING_V2' } }), 100);
  assert.equal(await prisma.backgroundJob.count({ where: { status: 'PROCESSING_V2' } }), 0);
  writeFileSync(
    process.env.INGESTION_JOB_HISTORY_EVIDENCE ||
      'plans/event-ingestion/local-retained-job-claims.json',
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        certifiedEnterprise: false,
        history,
        active: 100,
        repeats,
        scope:
          'Owned fixture with retained completed history and100ready compact parents; real production claim EXPLAIN ANALYZE inside rolled-back transactions. Preparation/ANALYZE excluded. No providers, complete throughput or production UI workload certificate. Raw predicates, payloads and query parameters are omitted from retained plans.',
      },
      null,
      2
    ) + '\n'
  );
})()
  .catch(() => {
    console.error('Owned retained-job claim diagnostic failed');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
