/* eslint-disable @typescript-eslint/no-require-imports -- Isolated executable diagnostic uses the shared TypeScript fixture runtime. */
/* eslint-disable security/detect-non-literal-fs-filename -- Evidence destination is an operator-selected local diagnostic artifact, never request input. */
require('./isolated-runtime.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const db = require('../../src/lib/prisma').default;
const { prepareStageFixture } = require('./capacity-stages.cjs');
const {
  processPendingJobs,
  GENERAL_WORKER_EXCLUDED_JOB_TYPES,
} = require('../../src/lib/jobs/queue');
let finishProfile;
(async () => {
  assert.equal(process.env.OPSKNIGHT_PROCESS_ROLE, 'general-worker');
  assert.equal(process.env.DATABASE_POOL_SIZE_GENERAL_WORKER, '5');
  const fixture = await prepareStageFixture(db, 'effects-only', 300);
  finishProfile = await require('./database-profile.cjs')(db);
  const started = performance.now(),
    cpu = process.cpuUsage();
  await db.$executeRaw`UPDATE "BackgroundJob" SET "scheduledAt"=clock_timestamp() WHERE type='SCHEDULED_TASK'`;
  let cycles = 0,
    processed = 0,
    failed = 0;
  while (performance.now() - started < 120000) {
    // Benchmark the same operational effects independently of split-lane
    // ownership. The production unified processor retains all predecessor and
    // lease checks; the dedicated general worker now excludes personal effects.
    const result = await processPendingJobs(100, 15, [...GENERAL_WORKER_EXCLUDED_JOB_TYPES]);
    cycles++;
    processed += result.processed;
    failed += result.failed;
    if (result.failed > 0 || result.total === 0) break;
  }
  const elapsedMs = performance.now() - started,
    usage = process.cpuUsage(cpu);
  const finish = finishProfile;
  finishProfile = undefined;
  const databaseProfile = await finish();
  const jobs = await db.backgroundJob.groupBy({ by: ['type', 'status'], _count: { _all: true } });
  const count = (type, status) =>
    jobs.find(r => r.type === type && r.status === status)?._count._all || 0;
  const passed =
    elapsedMs <= 120000 &&
    failed === 0 &&
    count('SCHEDULED_TASK', 'COMPLETED') === 1500 &&
    count('WAR_ROOM_PROVIDER_EVENT', 'COMPLETED') === 600 &&
    count('RUNBOOK', 'PENDING') === 300 &&
    jobs.reduce((n, r) => n + r._count._all, 0) === 2400;
  const evidence = {
    variant: process.env.INGESTION_DISPATCH_VARIANT || 'current-source',
    sourceRevision: process.env.INGESTION_DISPATCH_SOURCE_REVISION || 'working-tree-unverified',
    runtime: process.version,
    dispatcher: 'unified-operational-v2',
    certifiedEnterprise: false,
    measuredAt: new Date().toISOString(),
    passed,
    fixture,
    elapsedMs,
    cpuMs: (usage.user + usage.system) / 1000,
    cycles,
    processed,
    failed,
    jobs,
    unitsPerSecond: 300000 / elapsedMs,
    queriesPerUnit: databaseProfile.totalQueryCalls / 300,
    databaseProfile,
    scope:
      'Controlled host-process unified operational-queue diagnostic, 300 default 10KB critical-trigger incidents, no providers/users/Automation; 1,500 parents plus 600 generated child jobs must finish, 300 runbook jobs intentionally held. This is an execution-cost probe, not a split-general-worker routing test. Source variant is producer-identified; comparisons require controlled source and resources. No native-image, provider, full-stack or sustained capacity certification.',
  };
  const evidencePath =
    process.env.INGESTION_DISPATCH_EVIDENCE ||
    'plans/event-ingestion/local-general-dispatch-probe.json';
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  assert.ok(passed, 'General dispatch probe failed reconciliation');
})()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      if (finishProfile) await finishProfile();
    } catch {
      console.error('Dispatch profile cleanup failed');
      process.exitCode = 1;
    } finally {
      await db.$disconnect();
    }
  });
