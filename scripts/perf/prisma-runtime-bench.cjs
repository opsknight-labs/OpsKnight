/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS harness registers the shared TypeScript runtime. */
/* eslint-disable security/detect-non-literal-fs-filename -- writes evidence only to the operator-supplied output path */
/**
 * Prisma runtime benchmark for OpsKnight hot database paths.
 *
 * Measures the operations whose latency is dominated by the Prisma client/driver rather
 * than by product logic: raw round trips, primary-key lookups, list queries with relations,
 * short interactive transactions, batch writes and the real background-job claim query used
 * by every worker lane. Used to compare Prisma/driver upgrades on identical hardware.
 *
 * Usage (disposable database only):
 *   DATABASE_URL=postgresql://...@127.0.0.1:5432/prisma_bench node scripts/perf/prisma-runtime-bench.cjs out.json
 */
const { writeFileSync } = require('node:fs');

const database = new URL(process.env.DATABASE_URL || 'http://missing');
if (
  !['localhost', '127.0.0.1'].includes(database.hostname) ||
  !database.pathname.startsWith('/prisma_bench')
) {
  throw new Error(
    'Prisma runtime benchmark requires a disposable localhost prisma_bench* database'
  );
}
process.env.OPSKNIGHT_PROCESS_ROLE = process.env.OPSKNIGHT_PROCESS_ROLE || 'worker';
require('ts-node').register({ project: 'tsconfig.script.json', transpileOnly: true });
require('tsconfig-paths').register({
  baseUrl: process.cwd(),
  paths: { '@/*': ['src/*'], 'server-only': ['tests/mocks/server-only.ts'] },
});

const prisma = require('../../src/lib/prisma').default;
const { claimPendingJobs } = require('../../src/lib/jobs/queue');
const { runReadCommittedTransaction } = require('../../src/lib/db-utils');

const RUN = `bench-${process.pid}-${Date.now()}`;
const SCALE = Math.max(1, Number(process.env.PRISMA_BENCH_SCALE || 1));
const REPEATS = Math.max(1, Number(process.env.PRISMA_BENCH_REPEATS || 3));

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))] || 0;
}

async function measure(name, iterations, concurrency, operation) {
  const timings = [];
  let cursor = 0;
  const started = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (cursor < iterations) {
        const index = cursor++;
        const begin = performance.now();
        await operation(index);
        timings.push(performance.now() - begin);
      }
    })
  );
  const elapsed = performance.now() - started;
  timings.sort((a, b) => a - b);
  return {
    name,
    iterations,
    concurrency,
    opsPerSecond: Number(((iterations * 1000) / elapsed).toFixed(1)),
    p50Ms: Number(percentile(timings, 0.5).toFixed(3)),
    p95Ms: Number(percentile(timings, 0.95).toFixed(3)),
    p99Ms: Number(percentile(timings, 0.99).toFixed(3)),
  };
}

async function seed() {
  const users = Array.from({ length: 200 }, (_, i) => ({
    id: `${RUN}-u${i}`,
    name: `Bench ${i}`,
    email: `${RUN}-${i}@bench.test`,
  }));
  await prisma.user.createMany({ data: users });
  const services = Array.from({ length: 5 }, (_, i) => ({
    id: `${RUN}-s${i}`,
    name: `${RUN}-s${i}`,
  }));
  await prisma.service.createMany({ data: services });
  await prisma.incident.createMany({
    data: Array.from({ length: 500 }, (_, i) => ({
      id: `${RUN}-i${i}`,
      title: `Bench incident ${i}`,
      serviceId: services[i % services.length].id,
      createdAt: new Date(Date.now() - i * 1000),
    })),
  });
  await prisma.ingestionQuota.createMany({
    data: Array.from({ length: 64 }, (_, i) => ({
      key: `${RUN}-q${i}`,
      tokens: 0,
      rate: 1,
      burst: 1,
      updatedAt: new Date(),
      lastAllowed: false,
    })),
  });
  return { users, services };
}

async function cleanup() {
  await prisma.backgroundJob.deleteMany({ where: { payload: { path: ['bench'], equals: RUN } } });
  await prisma.incident.deleteMany({ where: { id: { startsWith: RUN } } });
  await prisma.service.deleteMany({ where: { id: { startsWith: RUN } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: RUN } } });
  await prisma.ingestionQuota.deleteMany({ where: { key: { startsWith: RUN } } });
}

async function jobClaimThroughput(jobs, workers, batch) {
  const past = new Date(Date.now() - 60_000);
  await prisma.backgroundJob.createMany({
    data: Array.from({ length: jobs }, () => ({
      type: 'ESCALATION',
      status: 'PENDING',
      scheduledAt: past,
      payload: { bench: RUN },
      maxAttempts: 3,
    })),
  });
  const claimed = new Map();
  let duplicates = 0;
  const claimTimings = [];
  const started = performance.now();
  await Promise.all(
    Array.from({ length: workers }, async () => {
      for (;;) {
        const begin = performance.now();
        const rows = await claimPendingJobs(batch, 'ESCALATION');
        claimTimings.push(performance.now() - begin);
        if (!rows.length) return;
        for (const row of rows) {
          if (claimed.has(row.id)) duplicates += 1;
          claimed.set(row.id, row.claimToken);
        }
        await prisma.backgroundJob.updateMany({
          where: { id: { in: rows.map(row => row.id) } },
          data: { status: 'COMPLETED', completedAt: new Date() },
        });
      }
    })
  );
  const elapsed = performance.now() - started;
  claimTimings.sort((a, b) => a - b);
  const remaining = await prisma.backgroundJob.count({
    where: { payload: { path: ['bench'], equals: RUN }, status: { not: 'COMPLETED' } },
  });
  await prisma.backgroundJob.deleteMany({ where: { payload: { path: ['bench'], equals: RUN } } });
  return {
    name: 'jobClaim',
    jobs,
    workers,
    batch,
    jobsPerSecond: Number(((jobs * 1000) / elapsed).toFixed(1)),
    claimP50Ms: Number(percentile(claimTimings, 0.5).toFixed(3)),
    claimP95Ms: Number(percentile(claimTimings, 0.95).toFixed(3)),
    claimed: claimed.size,
    duplicates,
    remaining,
    correct: claimed.size === jobs && duplicates === 0 && remaining === 0,
  };
}

async function suite({ users, services }) {
  const results = [];
  results.push(await measure('rawSelect1', 2000 * SCALE, 8, () => prisma.$queryRaw`SELECT 1`));
  results.push(
    await measure('findUniquePk', 2000 * SCALE, 8, i =>
      prisma.user.findUnique({ where: { id: users[i % users.length].id } })
    )
  );
  results.push(
    await measure('incidentListWithService', 300 * SCALE, 4, i =>
      prisma.incident.findMany({
        where: { serviceId: services[i % services.length].id },
        include: { service: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      })
    )
  );
  results.push(
    await measure('incidentCountGroupBy', 300 * SCALE, 4, () =>
      prisma.incident.groupBy({
        by: ['serviceId', 'status'],
        where: { id: { startsWith: RUN } },
        _count: { _all: true },
      })
    )
  );
  results.push(
    await measure('readCommittedTransaction', 1000 * SCALE, 8, i =>
      runReadCommittedTransaction(async tx => {
        const key = `${RUN}-q${i % 64}`;
        const quota = await tx.ingestionQuota.findUniqueOrThrow({ where: { key } });
        await tx.ingestionQuota.update({ where: { key }, data: { tokens: quota.tokens + 1 } });
      })
    )
  );
  results.push(
    await measure('batchCreateMany100', 100 * SCALE, 4, async () => {
      const ids = Array.from({ length: 100 }, () => crypto.randomUUID());
      await prisma.backgroundJob.createMany({
        data: ids.map(id => ({
          id,
          type: 'NOTIFICATION',
          status: 'COMPLETED',
          scheduledAt: new Date(),
          payload: { bench: RUN },
        })),
      });
    })
  );
  results.push(await jobClaimThroughput(2000 * SCALE, 4, 10));
  return results;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

(async () => {
  const { version } = require('@prisma/client/package.json');
  await cleanup();
  const fixtures = await seed();
  await suite(fixtures); // warm-up: connection pool, plan caches, JIT
  const runs = [];
  for (let i = 0; i < REPEATS; i += 1) runs.push(await suite(fixtures));
  const summary = runs[0].map((first, index) => {
    const samples = runs.map(run => run[index]);
    const merged = { ...first };
    for (const key of Object.keys(first)) {
      if (
        typeof first[key] === 'number' &&
        !['iterations', 'concurrency', 'jobs', 'workers', 'batch'].includes(key)
      ) {
        merged[key] = median(samples.map(sample => sample[key]));
      }
    }
    if ('correct' in first) merged.correct = samples.every(sample => sample.correct);
    return merged;
  });
  const [{ backends }] = await prisma.$queryRaw`
    SELECT count(*)::int AS backends FROM pg_stat_activity WHERE datname = current_database()`;
  await cleanup();
  const evidence = {
    measuredAt: new Date().toISOString(),
    prismaClient: version,
    node: process.version,
    role: process.env.OPSKNIGHT_PROCESS_ROLE,
    target: `${database.hostname}:${database.port}${database.pathname}`,
    repeats: REPEATS,
    scale: SCALE,
    rssMiB: Math.round(process.memoryUsage().rss / 1048576),
    serverBackendsAtEnd: backends,
    results: summary,
  };
  const json = `${JSON.stringify(evidence, null, 2)}\n`;
  if (process.argv[2]) writeFileSync(process.argv[2], json);
  process.stdout.write(json);
})()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
