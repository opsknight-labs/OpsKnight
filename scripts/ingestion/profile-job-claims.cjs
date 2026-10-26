/* eslint-disable @typescript-eslint/no-require-imports -- Native local diagnostic uses the shared TypeScript fixture runtime. */
/* eslint-disable security/detect-non-literal-fs-filename -- Explicit local evidence destination. */
require('./isolated-runtime.cjs');
const assert = require('node:assert/strict');
const { writeFileSync } = require('node:fs');
const prisma = require('../../src/lib/prisma').default;
const {
  claimPendingOperationalJobs,
  GENERAL_WORKER_EXCLUDED_JOB_TYPES,
} = require('../../src/lib/jobs/queue');

const { boundedPlan } = require('./query-plan-summary.cjs');
async function main() {
  assert.equal(new URL(process.env.DATABASE_URL).port, '55445');
  const [state] = await prisma.$queryRaw`
    SELECT to_regclass('"BackgroundJob_claim_live_order_idx"')::text AS installed,
      (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database()
        AND pid<>pg_backend_pid() AND backend_type='client backend') AS clients
  `;
  assert.equal(state.installed, null, 'Use a disposable pre-index fixture clone for A/B');
  assert.equal(state.clients, 0, 'Stop all clients to this diagnostic database first');
  const statements = [];
  const original = prisma.$queryRaw;
  prisma.$queryRaw = async statement => {
    statements.push(statement);
    return [];
  };
  try {
    await claimPendingOperationalJobs(100, GENERAL_WORKER_EXCLUDED_JOB_TYPES);
  } finally {
    prisma.$queryRaw = original;
  }
  assert.equal(statements.length, 2);
  const statement = statements[1];
  assert.ok(statement.text.includes('candidate."status" IN'), 'Candidate must expose live states');
  const rollback = new Error('Rollback diagnostic job claims and index');
  const repeats = [];
  for (const liveIndex of [false, true, false, true]) {
    try {
      await prisma.$transaction(
        async tx => {
          if (liveIndex)
            await tx.$executeRaw`
          CREATE INDEX "BackgroundJob_claim_live_order_idx"
          ON "BackgroundJob" ("scheduledAt", "createdAt", "id")
          WHERE "status" IN ('PENDING'::"JobStatus", 'PROCESSING'::"JobStatus",
            'PENDING_V2'::"JobStatus", 'PROCESSING_V2'::"JobStatus") AND "attempts" < "maxAttempts"
        `;
          // Statement comes only from the production SQL builder above; its values
          // remain bound parameters. No caller SQL or job payload enters the text.
          const rows = await tx.$queryRawUnsafe(
            'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + statement.text,
            ...statement.values
          );
          const plan = rows[0]['QUERY PLAN'][0];
          repeats.push({
            liveIndex,
            executionMs: plan['Execution Time'],
            planningMs: plan['Planning Time'],
            plan: boundedPlan(plan.Plan),
          });
          throw rollback;
        },
        { timeout: 60000, maxWait: 2000 }
      );
    } catch (error) {
      if (error !== rollback) throw error;
    }
  }
  const evidence = {
    certifiedEnterprise: false,
    scope:
      'Rollback-only production ordinary/general claim ABAB on an isolated, stopped pre-index fixture. Index creation excluded from execution timings. Never a production configuration or application throughput certification.',
    repeats,
  };
  writeFileSync(
    process.env.INGESTION_JOB_PROFILE_EVIDENCE ||
      'plans/event-ingestion/local-job-claim-live-index-repeat.json',
    JSON.stringify(evidence, null, 2) + '\n'
  );
}
main()
  .catch(() => {
    console.error('Isolated job claim profiling failed');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
