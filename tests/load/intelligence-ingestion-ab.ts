/**
 * Controlled A/B benchmark: does running the intelligence lane slow alert ingestion?
 *
 * Both arms use the same code path (processEvent: advisory lock, incident creation, outbox) against
 * the same pre-seeded database. They differ only in whether the intelligence lane is enabled and busy
 * in the SAME process and connection pool (the "integrated" role, the worst case for contention).
 * Arms alternate order each repetition and results are paired by repetition, so slow machine drift
 * cancels out. The report states a verdict per metric relative to measured run-to-run noise and
 * deliberately refuses to judge from too few repetitions.
 *
 * Usage (dedicated database whose name ends in _bench or _test; the script truncates incident data):
 *   DATABASE_URL=postgresql://.../opsknight_bench \
 *   npx ts-node -r tsconfig-paths/register --project tsconfig.script.json \
 *     tests/load/intelligence-ingestion-ab.ts --repetitions 8 --events 300 --concurrency 16 --backlog 400
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import prisma from '../../src/lib/prisma';
import { processEvent, type EventPayload } from '../../src/lib/events';
import {
  DEFAULT_POLICY_DEFINITION,
  INTELLIGENCE_SETTINGS_DEFAULTS,
} from '../../src/lib/intelligence/contract';
import {
  DEFAULT_HANDLERS,
  createLaneState,
  runIntelligenceCycle,
  type WorkHandlers,
} from '../../src/lib/intelligence/jobs/runner';
import { enqueueWorkItems, type WorkKind } from '../../src/lib/intelligence/jobs/work-queue';
import {
  comparePaired,
  judgeHigherIsWorse,
  judgeLowerIsWorse,
  percentile,
} from './helpers/ab-stats';

type Arm = 'baseline' | 'candidate';

interface Options {
  repetitions: number;
  events: number;
  concurrency: number;
  backlog: number;
  services: number;
}

interface Sample {
  arm: Arm;
  repetition: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  p999Ms: number;
  maxMs: number;
  throughputPerSec: number;
  failures: number;
  peakLockWaiters: number;
  peakActiveBackends: number;
  /** Work items the lane completed during the burst; must be > 0 for the candidate arm to mean anything. */
  laneItemsProcessed: number;
}

function parseOptions(argv: string[]): Options {
  const read = (name: string, fallback: number) => {
    const index = argv.indexOf(`--${name}`);
    const value = index >= 0 ? Number(argv[index + 1]) : fallback;
    if (!Number.isInteger(value) || value < 1)
      throw new Error(`--${name} must be a positive integer`);
    return value;
  };
  return {
    repetitions: read('repetitions', 8),
    events: read('events', 300),
    concurrency: read('concurrency', 16),
    // Large enough that the lane stays busy for the whole timed burst.
    backlog: read('backlog', 3000),
    services: read('services', 4),
  };
}

function assertDedicatedDatabase() {
  const name = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/').pathname;
  if (!/_(bench|test)$/.test(name)) {
    throw new Error(
      `Refusing to run: database "${name}" must end in _bench or _test (it is truncated).`
    );
  }
}

async function reset() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Incident", "BackgroundJob", "IntelligenceWorkItem", "IntelligenceCursor" CASCADE'
  );
}

async function seedFixtures(serviceCount: number) {
  const services = [];
  for (let i = 0; i < serviceCount; i += 1) {
    services.push(
      await prisma.service.upsert({
        where: { name: `ab-service-${i}` },
        update: {},
        create: { name: `ab-service-${i}` },
      })
    );
  }
  const policy = await prisma.intelligencePolicy.upsert({
    where: { scopeKey: 'global' },
    update: {},
    create: { scopeKey: 'global', headVersion: 1 },
  });
  await prisma.intelligencePolicyVersion.upsert({
    where: { policyId_version: { policyId: policy.id, version: 1 } },
    update: {},
    create: {
      policyId: policy.id,
      version: 1,
      mode: 'SUGGEST',
      definition: DEFAULT_POLICY_DEFINITION,
    },
  });
  return services;
}

async function setIntelligence(enabled: boolean) {
  await prisma.intelligenceSettings.upsert({
    where: { id: 'default' },
    update: { enabled },
    create: { id: 'default', ...INTELLIGENCE_SETTINGS_DEFAULTS, enabled },
  });
}

/** Identical backlog in both arms so table sizes match; only the candidate arm queues work for it. */
async function seedBacklog(serviceIds: string[], count: number, queueWork: boolean) {
  const old = new Date(Date.now() - 600_000);
  const rows = Array.from({ length: count }, (_, i) => ({
    title: `Database connection errors on db-primary-${i % 7}`,
    serviceId: serviceIds[i % serviceIds.length],
    status: 'OPEN' as const,
    urgency: 'LOW' as const,
    createdAt: old,
  }));
  await prisma.incident.createMany({ data: rows });
  if (queueWork) {
    const incidents = await prisma.incident.findMany({ select: { id: true } });
    await enqueueWorkItems(
      incidents.map(incident => ({ kind: 'INDEX_INCIDENT' as const, subjectKey: incident.id }))
    );
  }
}

async function sampleDatabase(stop: { done: boolean }) {
  let peakLockWaiters = 0;
  let peakActiveBackends = 0;
  while (!stop.done) {
    const [row] = await prisma.$queryRaw<Array<{ waiting: bigint; active: bigint }>>`
      SELECT count(*) FILTER (WHERE wait_event_type = 'Lock')::bigint AS waiting,
             count(*) FILTER (WHERE state = 'active')::bigint AS active
      FROM pg_stat_activity WHERE datname = current_database()`;
    peakLockWaiters = Math.max(peakLockWaiters, Number(row?.waiting ?? 0));
    peakActiveBackends = Math.max(peakActiveBackends, Number(row?.active ?? 0));
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return { peakLockWaiters, peakActiveBackends };
}

function eventFor(index: number, tag: string): EventPayload {
  return {
    event_action: 'trigger',
    dedup_key: `ab-${tag}-${index}`,
    payload: {
      summary: `Latency high on api-${index % 11}`,
      source: 'ab-benchmark',
      severity: 'warning',
    },
  };
}

async function runBurst(serviceIds: string[], options: Options, tag: string) {
  const latencies: number[] = [];
  let failures = 0;
  let next = 0;
  const stopSampling = { done: false };
  const sampler = sampleDatabase(stopSampling);
  const started = performance.now();
  await Promise.all(
    Array.from({ length: options.concurrency }, async () => {
      while (next < options.events) {
        const index = next++;
        const t0 = performance.now();
        try {
          await processEvent(
            eventFor(index, tag),
            serviceIds[index % serviceIds.length],
            `ab-integration-${index % serviceIds.length}`
          );
        } catch {
          failures += 1;
        }
        latencies.push(performance.now() - t0);
      }
    })
  );
  const elapsedSec = (performance.now() - started) / 1000;
  stopSampling.done = true;
  const db = await sampler;
  return { latencies, failures, elapsedSec, ...db };
}

/** Keep the candidate busy: this harness publishes paging intents but has no paging delivery worker.
 * Bypass that synthetic backlog's backpressure in the harness only to measure worst-case contention.
 */
function busyCandidate() {
  const tracker = { completed: 0, stop: false };
  const handlers = Object.fromEntries(
    Object.entries(DEFAULT_HANDLERS).map(([kind, handler]) => [
      kind,
      async (...args: Parameters<NonNullable<WorkHandlers[WorkKind]>>) => {
        const result = await handler!(...args);
        tracker.completed++;
        return result;
      },
    ])
  ) as WorkHandlers;
  const state = createLaneState();
  const active = (async () => {
    while (!tracker.stop) {
      Object.assign(state, {
        lastReconcileAt: Date.now(),
        lastRetentionAt: Date.now(),
        lastObserveAt: Date.now(),
        lastEmbedAt: Date.now(),
        lastDigestCheckAt: Date.now(),
      });
      await runIntelligenceCycle(state, { handlers, getCriticalLagMs: async () => 0 });
      await new Promise(resolve => setTimeout(resolve, 1));
    }
  })();
  return {
    tracker,
    stop: async () => {
      tracker.stop = true;
      await active;
    },
  };
}

async function runArm(arm: Arm, repetition: number, options: Options): Promise<Sample> {
  await reset();
  const services = await seedFixtures(options.services);
  const serviceIds = services.map(service => service.id);
  await setIntelligence(arm === 'candidate');
  await seedBacklog(serviceIds, options.backlog, arm === 'candidate');

  const lane = arm === 'candidate' ? busyCandidate() : null;
  // Warm connections and caches in both arms so neither pays cold-start cost inside the timed window.
  await runBurst(serviceIds, { ...options, events: 20 }, `warm-${arm}-${repetition}`);
  // The queue length stays flat (indexing chains an analysis item), so progress is read from the
  // lane's own completed-work counter.
  if (lane) {
    const deadline = Date.now() + 30000;
    while (lane.tracker.completed === 0) {
      if (Date.now() >= deadline) {
        await lane.stop();
        throw new Error('Candidate lane did not become active');
      }
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  }
  const completedBefore = lane?.tracker.completed ?? 0;
  const burst = await runBurst(serviceIds, options, `${arm}-${repetition}`);
  const completedAfter = lane?.tracker.completed ?? 0;
  await lane?.stop();

  return {
    arm,
    repetition,
    p50Ms: percentile(burst.latencies, 0.5),
    p95Ms: percentile(burst.latencies, 0.95),
    p99Ms: percentile(burst.latencies, 0.99),
    p999Ms: percentile(burst.latencies, 0.999),
    maxMs: Math.max(...burst.latencies),
    throughputPerSec: burst.latencies.length / burst.elapsedSec,
    failures: burst.failures,
    peakLockWaiters: burst.peakLockWaiters,
    peakActiveBackends: burst.peakActiveBackends,
    laneItemsProcessed: arm === 'candidate' ? Math.max(0, completedAfter - completedBefore) : 0,
  };
}

function summarize(samples: Sample[]) {
  const column = (arm: Arm, pick: (sample: Sample) => number) =>
    samples
      .filter(sample => sample.arm === arm)
      .sort((a, b) => a.repetition - b.repetition)
      .map(pick);
  const metrics = [
    { name: 'p50 latency (ms)', pick: (s: Sample) => s.p50Ms, judge: judgeHigherIsWorse },
    { name: 'p95 latency (ms)', pick: (s: Sample) => s.p95Ms, judge: judgeHigherIsWorse },
    { name: 'p99 latency (ms)', pick: (s: Sample) => s.p99Ms, judge: judgeHigherIsWorse },
    { name: 'p99.9 latency (ms)', pick: (s: Sample) => s.p999Ms, judge: judgeHigherIsWorse },
    {
      name: 'throughput (events/s)',
      pick: (s: Sample) => s.throughputPerSec,
      judge: judgeLowerIsWorse,
    },
  ];
  return metrics.map(metric => {
    const comparison = comparePaired(
      column('baseline', metric.pick),
      column('candidate', metric.pick)
    );
    return {
      metric: metric.name,
      medianRatio: comparison.interval.estimate,
      ci95: [comparison.interval.lower, comparison.interval.upper],
      baselineRunToRunCv: comparison.baselineCv,
      noiseFloor: comparison.noiseFloor,
      verdict: metric.judge(comparison),
    };
  });
}

async function main() {
  assertDedicatedDatabase();
  const options = parseOptions(process.argv.slice(2));
  const samples: Sample[] = [];
  for (let repetition = 0; repetition < options.repetitions; repetition += 1) {
    // Alternate which arm goes first so ordering effects cancel.
    const order: Arm[] =
      repetition % 2 === 0 ? ['baseline', 'candidate'] : ['candidate', 'baseline'];
    for (const arm of order) {
      const sample = await runArm(arm, repetition, options);
      samples.push(sample);
      console.log(
        `rep ${repetition} ${arm.padEnd(9)} p50=${sample.p50Ms.toFixed(1)}ms p99=${sample.p99Ms.toFixed(1)}ms ` +
          `${sample.throughputPerSec.toFixed(0)}/s fail=${sample.failures} lane=${sample.laneItemsProcessed}`
      );
    }
  }
  const summary = summarize(samples);
  const candidate = samples.filter(sample => sample.arm === 'candidate');
  // Counts that are usually zero cannot be judged as ratios, so they are reported raw per arm.
  const rawCounts = (['baseline', 'candidate'] as Arm[]).map(arm => {
    const rows = samples.filter(sample => sample.arm === arm);
    return {
      arm,
      maxPeakLockWaiters: Math.max(...rows.map(row => row.peakLockWaiters)),
      maxPeakActiveBackends: Math.max(...rows.map(row => row.peakActiveBackends)),
      failures: rows.reduce((sum, row) => sum + row.failures, 0),
    };
  });
  const laneBusy = candidate.every(sample => sample.laneItemsProcessed > 0);
  const report = {
    generatedAt: new Date().toISOString(),
    options,
    laneWasBusyInEveryCandidateRun: laneBusy,
    node: process.version,
    pagingBackpressureBypassed: true,
    totalFailures: samples.reduce((sum, sample) => sum + sample.failures, 0),
    summary,
    rawCounts,
    samples,
    interpretation:
      'Verdicts compare paired repetitions against measured baseline noise. NO_DETECTABLE_DIFFERENCE means the ' +
      'difference is within noise, not that it is zero. Treat results from shared or loaded hosts as indicative only.',
  };
  mkdirSync('reports/intelligence-ingestion-ab', { recursive: true });
  const path = `reports/intelligence-ingestion-ab/${report.generatedAt.replace(/[:.]/g, '-')}.json`;
  writeFileSync(path, JSON.stringify(report, null, 2));

  console.log('\n| Metric | Median ratio (candidate/baseline) | 95% CI | Baseline CV | Verdict |');
  console.log('| :--- | :---: | :---: | :---: | :--- |');
  for (const row of summary) {
    console.log(
      `| ${row.metric} | ${row.medianRatio.toFixed(3)} | ${row.ci95[0].toFixed(3)} – ${row.ci95[1].toFixed(3)} | ${(row.baselineRunToRunCv * 100).toFixed(1)}% | ${row.verdict} |`
    );
  }
  console.log(
    `\nRaw counts: ${rawCounts.map(c => `${c.arm}: lock waiters ≤ ${c.maxPeakLockWaiters}, active backends ≤ ${c.maxPeakActiveBackends}, failures ${c.failures}`).join(' | ')}`
  );
  console.log(`Lane busy in every candidate run: ${laneBusy}. Report: ${path}`);
  if (!laneBusy)
    console.log(
      'WARNING: the lane did no work in some candidate runs; those results do not test contention.'
    );
  await prisma.$disconnect();
}

main().catch(async error => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
