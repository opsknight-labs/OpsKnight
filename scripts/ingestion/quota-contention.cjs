/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS diagnostic loads the shared TypeScript fixture runtime. */
/* eslint-disable security/detect-non-literal-fs-filename -- Evidence destination is an operator-selected local output path. */
require('./isolated-runtime.cjs');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { writeFileSync } = require('node:fs');
const prisma = require('../../src/lib/prisma').default;
const { checkIngestionQuota } = require('../../src/lib/ingestion/quota');
const { getIngestionPolicy } = require('../../src/lib/ingestion/policy');
const run = randomUUID();
const evidence = {
  certifiedEnterprise: false,
  scope:
    'Single Node library process and isolated local Docker PostgreSQL; excludes HTTP, incident processing, Automation and provider delivery',
  coalescing: process.env.INGESTION_QUOTA_COALESCE !== 'false',
  scenarios: [],
};
async function main() {
  const url = new URL(process.env.DATABASE_URL);
  assert.ok(
    url.pathname.startsWith('/ingestion_test_quota'),
    'Use an owned isolated quota fixture'
  );
  assert.equal(url.port, '55445');
  assert.equal(require('../../src/lib/ingestion/config').ingestionConfig().mode, 'postgres');
  await prisma.$queryRaw`SELECT calls FROM pg_stat_statements LIMIT 0`;
  const { policy } = await getIngestionPolicy();
  const value = {
    paused: false,
    revision: 0,
    policy: {
      ...policy,
      quotas: {
        eventsPerMinute: 10000000,
        eventsBurst: 10000000,
        integrationPerMinute: 10000000,
        integrationBurst: 10000000,
      },
    },
  };
  await prisma.systemConfig.upsert({
    where: { key: 'ingestion_control' },
    create: { key: 'ingestion_control', value },
    update: { value },
  });
  // A transaction-shaped direct adapter bypasses coalescing for a controlled
  // scalar comparison using the same SQL and policy; no production flag changes.
  const quotaClient = evidence.coalescing
    ? prisma
    : {
        systemConfig: prisma.systemConfig,
        $queryRaw: prisma.$queryRaw.bind(prisma),
      };
  const decide = key => checkIngestionQuota(key, 120, 60000, quotaClient);
  const decisions = Number(process.env.INGESTION_QUOTA_DECISIONS || 20000);
  const concurrency = Number(process.env.INGESTION_QUOTA_CONCURRENCY || 32);
  assert.ok(Number.isInteger(decisions) && decisions >= 100 && decisions <= 100000);
  assert.ok(Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 128);
  for (const keys of [1, 100]) {
    const quotaKeys = Array.from(
      { length: keys },
      (_, index) => `quota-contention:${run}:${keys}:${index}:events`
    );
    for (const key of quotaKeys) assert.ok((await decide(key)).allowed);
    const finish = await require('./database-profile.cjs')(prisma);
    const latencies = [];
    let next = 0;
    let allowed = 0;
    const cpuStarted = process.cpuUsage();
    const started = performance.now();
    await Promise.all(
      Array.from({ length: concurrency }, async () => {
        while (next < decisions) {
          const index = next++;
          const at = performance.now();
          const result = await decide(quotaKeys.at(index % keys));
          latencies.push(performance.now() - at);
          if (result.allowed) allowed++;
        }
      })
    );
    const elapsedMs = performance.now() - started;
    const cpu = process.cpuUsage(cpuStarted);
    latencies.sort((a, b) => a - b);
    const percentile = fraction => latencies.at(Math.ceil(latencies.length * fraction) - 1);
    const databaseProfile = await finish();
    evidence.scenarios.push({
      keys,
      concurrency,
      decisions,
      allowed,
      elapsedMs,
      cpuMs: (cpu.user + cpu.system) / 1000,
      cpuMsPerDecision: (cpu.user + cpu.system) / 1000 / decisions,
      decisionsPerSecond: (decisions * 1000) / elapsedMs,
      requestLatencyMs: {
        p50: percentile(0.5),
        p95: percentile(0.95),
        p99: percentile(0.99),
        max: latencies.at(-1),
      },
      databaseProfile,
    });
    assert.equal(allowed, decisions);
  }
}
main()
  .catch(error => {
    evidence.error = error.message;
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    evidence.measuredAt = new Date().toISOString();
    evidence.sourceRevision = require('node:child_process')
      .spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' })
      .stdout.trim();
    evidence.sourceDirty = !!require('node:child_process')
      .spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8' })
      .stdout.trim();
    writeFileSync(
      process.env.INGESTION_QUOTA_EVIDENCE || 'plans/event-ingestion/local-quota-contention.json',
      JSON.stringify(evidence, null, 2) + '\n'
    );
  });
