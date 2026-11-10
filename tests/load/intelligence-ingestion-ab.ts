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
 * It is also the ingestion release gate: the median paired difference between arms must stay within the
 * contract (p99 at most +10 ms, p50 at most +2 ms), the lane must have been busy in every candidate run and
 * no event may fail; otherwise the process exits 1. `--no-gate` records without judging.
 *
 * With `--noise-controls on` the candidate arm also has every pre-paging noise control ON for the bench
 * services (maintenance window, suppression and orchestration rules that never match, and content dedup,
 * flapping and storm grouping with thresholds that run every lookup on every event but never change the
 * outcome), so the gate measures the hook's full cost: "all features ON vs everything OFF". `--no-lane`
 * keeps the lane idle in both arms to isolate the hook. `--history N` seeds N resolved incidents (one
 * alert each, spread over 90 days) per arm, so lookups run against a large table. `--noise-lookups
 * transaction` keeps the hook's reads on the event transaction (savepoint) instead of the default
 * dedicated lookup pool.
 *
 * Usage (dedicated database whose name ends in _bench or _test; the script truncates incident data):
 *   DATABASE_URL=postgresql://.../opsknight_bench \
 *   npx ts-node -r tsconfig-paths/register --project tsconfig.script.json \
 *     tests/load/intelligence-ingestion-ab.ts --repetitions 8 --events 300 --concurrency 16 --backlog 400 \
 *     [--noise-controls on] [--noise-lookups pool|transaction] [--no-lane] [--history 1000000] \
 *     [--max-p99-delta-ms 10] [--max-p50-delta-ms 2] [--output reports/ingestion-ab.json] [--no-gate]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
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
  primePrePagingSnapshot,
  resetPrePagingSnapshot,
} from '../../src/lib/intelligence/noise-controls';
import {
  disconnectNoiseLookupClient,
  setNoiseLookupRoute,
} from '../../src/lib/intelligence/noise-controls/lookup-client';
import { runtimeOperationalMetrics } from '../../src/lib/metrics/operational/registry';
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
  /** Candidate arm also runs every pre-paging noise control ON (baseline: all OFF). */
  noiseControls: boolean;
  /** Where the hook's reads run: the dedicated lookup pool (default) or the event transaction. */
  noiseLookups: 'pool' | 'transaction';
  /** Candidate arm runs the busy intelligence lane (default). */
  lane: boolean;
  /** Resolved incidents (one alert each) seeded per arm before the burst. 0 = none. */
  history: number;
  /** Release contract: how much the lane may add to ingestion latency, as a median paired difference. */
  maxP99DeltaMs: number;
  maxP50DeltaMs: number;
  gate: boolean;
  output: string | null;
}

/** Median of the per-repetition differences (candidate minus baseline). */
function medianPairedDelta(samples: Sample[], pick: (sample: Sample) => number): number {
  const byRepetition = new Map<number, Partial<Record<Arm, number>>>();
  for (const sample of samples) {
    const entry = byRepetition.get(sample.repetition) ?? {};
    entry[sample.arm] = pick(sample);
    byRepetition.set(sample.repetition, entry);
  }
  const deltas = [...byRepetition.values()]
    .filter(entry => entry.baseline !== undefined && entry.candidate !== undefined)
    .map(entry => entry.candidate! - entry.baseline!);
  return deltas.length ? percentile(deltas, 0.5) : Number.NaN;
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
  /** Pre-paging evaluations that failed open during the timed burst, by reason. */
  noiseFailOpen: Record<string, number>;
  /** Pre-paging decisions recorded during the timed burst (expected 0 with the lookup-only profile). */
  noiseDecisions: number;
}

function parseOptions(argv: string[]): Options {
  const read = (name: string, fallback: number) => {
    const index = argv.indexOf(`--${name}`);
    const value = index >= 0 ? Number(argv[index + 1]) : fallback;
    if (!Number.isInteger(value) || value < 1)
      throw new Error(`--${name} must be a positive integer`);
    return value;
  };
  const outputAt = argv.indexOf('--output');
  const noiseAt = argv.indexOf('--noise-controls');
  const lookupsAt = argv.indexOf('--noise-lookups');
  const noiseLookups = lookupsAt >= 0 ? argv[lookupsAt + 1] : 'pool';
  if (noiseLookups !== 'pool' && noiseLookups !== 'transaction')
    throw new Error('--noise-lookups must be pool or transaction');
  const historyAt = argv.indexOf('--history');
  const history = historyAt >= 0 ? Number(argv[historyAt + 1]) : 0;
  if (!Number.isInteger(history) || history < 0)
    throw new Error('--history must be a non-negative integer');
  return {
    noiseControls: noiseAt >= 0 && argv[noiseAt + 1] === 'on',
    noiseLookups,
    lane: !argv.includes('--no-lane'),
    history,
    repetitions: read('repetitions', 8),
    events: read('events', 300),
    concurrency: read('concurrency', 16),
    // Large enough that the lane stays busy for the whole timed burst.
    backlog: read('backlog', 3000),
    services: read('services', 4),
    maxP99DeltaMs: read('max-p99-delta-ms', 10),
    maxP50DeltaMs: read('max-p50-delta-ms', 2),
    gate: !argv.includes('--no-gate'),
    output: outputAt >= 0 ? argv[outputAt + 1] : null,
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
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Alert", "NoiseControlPolicy", "MaintenanceWindow", "SuppressionRule", "PrePagingDecision" CASCADE'
  );
}

/** Resolved history spread over 90 days with one fingerprinted alert each, in bounded SQL batches. */
async function seedHistory(serviceIds: string[], count: number) {
  // Small enough to stay well inside the default statement timeout on a busy host.
  const batch = 20_000;
  for (let offset = 0; offset < count; offset += batch) {
    const size = Math.min(batch, count - offset);
    await prisma.$executeRawUnsafe(
      `WITH rows AS (
         SELECT g AS n, ($1::text[])[1 + (g % array_length($1::text[], 1))] AS service_id,
                now() - (interval '90 days' * random()) - interval '1 hour' AS at
         FROM generate_series($2::int, $2::int + $3::int - 1) AS g
       ), incidents AS (
         INSERT INTO "Incident" ("id", "title", "serviceId", "status", "urgency", "createdAt", "updatedAt", "resolvedAt", "dedupKey")
         SELECT 'hist-' || n, 'Historic latency on api-' || (n % 97), service_id, 'RESOLVED', 'LOW', at, at, at, 'hist-' || n
         FROM rows RETURNING "id", "serviceId", "createdAt"
       )
       INSERT INTO "Alert" ("id", "dedupKey", "status", "payload", "serviceId", "incidentId", "createdAt", "fingerprintHash", "severity")
       SELECT 'hist-a-' || substr("id", 6), 'hist-' || substr("id", 6), 'RESOLVED', '{}'::jsonb, "serviceId", "id", "createdAt",
              md5('tpl-' || (hashtext("id") % 997)::text), 'warning'
       FROM incidents`,
      serviceIds,
      offset,
      size
    );
  }
  await prisma.$executeRawUnsafe('ANALYZE "Incident"');
  await prisma.$executeRawUnsafe('ANALYZE "Alert"');
}

/**
 * Every control ON for every bench service, tuned so each event runs every lookup (dedup, flapping, storm
 * count and parent) and every static matcher, yet nothing changes the outcome: the arms do the same work
 * apart from the hook. The bench events carry a unique label, so the label-subset dedup check never holds.
 */
async function enableNoiseControls(serviceIds: string[]) {
  const now = Date.now();
  for (const serviceId of serviceIds) {
    await prisma.noiseControlPolicy.create({
      data: {
        scopeKey: `service:${serviceId}`,
        serviceId,
        mode: 'ON',
        definition: {
          schemaVersion: 1,
          contentDedup: { enabled: true, windowSeconds: 900, requireLabelSubset: true },
          flapping: { enabled: true, windowSeconds: 180, threshold: 50, keyOnFingerprint: true },
          storm: { enabled: true, threshold: 1000, windowSeconds: 60, holdSeconds: 0 },
          orchestration: {
            rules: [
              {
                id: 'never',
                name: 'Never matches',
                enabled: true,
                conditions: [{ field: 'source', op: 'equals', value: 'not-the-bench' }],
                actions: [{ type: 'SUPPRESS' }],
              },
            ],
          },
        },
      },
    });
    await prisma.suppressionRule.create({
      data: {
        name: 'Never matches',
        serviceId,
        matchers: [{ field: 'summary', op: 'regex', value: '^never-[0-9]+$' }],
        effect: 'SUPPRESS',
      },
    });
  }
  await prisma.maintenanceWindow.create({
    data: {
      name: 'Never matches',
      scope: 'LABEL',
      labelKey: 'bench_window',
      labelValue: 'never',
      startsAt: new Date(now - 60_000),
      endsAt: new Date(now + 6 * 3_600_000),
    },
  });
  resetPrePagingSnapshot();
  const snapshot = await primePrePagingSnapshot();
  if (!snapshot || snapshot.policies.size < serviceIds.length)
    throw new Error('Noise-control snapshot did not load');
}

function failOpenCounts(): Record<string, number> {
  const rows = runtimeOperationalMetrics().get('opsknight_prepaging_fail_open_total') ?? [];
  return Object.fromEntries(rows.map(row => [row.labels.reason ?? 'unknown', row.value]));
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
      custom_details: { bench_event: `${tag}-${index}` },
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
        lastUpdatedRepairAt: Date.now(),
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
  const laneOn = arm === 'candidate' && options.lane;
  await setIntelligence(laneOn);
  if (options.history > 0) await seedHistory(serviceIds, options.history);
  await seedBacklog(serviceIds, options.backlog, laneOn);
  if (arm === 'candidate' && options.noiseControls) await enableNoiseControls(serviceIds);
  else resetPrePagingSnapshot();

  const lane = laneOn ? busyCandidate() : null;
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
  const failOpenBefore = failOpenCounts();
  const decisionsBefore = await prisma.prePagingDecision.count();
  const burst = await runBurst(serviceIds, options, `${arm}-${repetition}`);
  const completedAfter = lane?.tracker.completed ?? 0;
  const failOpenAfter = failOpenCounts();
  const noiseDecisions = (await prisma.prePagingDecision.count()) - decisionsBefore;
  await lane?.stop();
  const noiseFailOpen = Object.fromEntries(
    Object.entries(failOpenAfter)
      .map(([reason, value]) => [reason, value - (failOpenBefore[reason] ?? 0)] as const)
      .filter(([, value]) => value > 0)
  );

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
    laneItemsProcessed: laneOn ? Math.max(0, completedAfter - completedBefore) : 0,
    noiseFailOpen,
    noiseDecisions,
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
  setNoiseLookupRoute(options.noiseLookups);
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
          `${sample.throughputPerSec.toFixed(0)}/s fail=${sample.failures} lane=${sample.laneItemsProcessed}` +
          (options.noiseControls
            ? ` noiseFailOpen=${JSON.stringify(sample.noiseFailOpen)} noiseDecisions=${sample.noiseDecisions}`
            : '')
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
  const laneBusy = !options.lane || candidate.every(sample => sample.laneItemsProcessed > 0);
  const totalFailures = samples.reduce((sum, sample) => sum + sample.failures, 0);
  const p99DeltaMs = medianPairedDelta(samples, sample => sample.p99Ms);
  const p50DeltaMs = medianPairedDelta(samples, sample => sample.p50Ms);
  const breaches: string[] = [];
  if (!(p99DeltaMs <= options.maxP99DeltaMs))
    breaches.push(`p99 +${p99DeltaMs.toFixed(2)} ms > ${options.maxP99DeltaMs} ms`);
  if (!(p50DeltaMs <= options.maxP50DeltaMs))
    breaches.push(`p50 +${p50DeltaMs.toFixed(2)} ms > ${options.maxP50DeltaMs} ms`);
  if (!laneBusy) breaches.push('lane idle in a candidate run (contention not exercised)');
  if (totalFailures > 0) breaches.push(`${totalFailures} ingestion failures`);
  const gate = {
    contract: { maxP99DeltaMs: options.maxP99DeltaMs, maxP50DeltaMs: options.maxP50DeltaMs },
    medianPairedDeltaMs: { p50: p50DeltaMs, p99: p99DeltaMs },
    breaches,
    passed: breaches.length === 0,
  };
  const report = {
    generatedAt: new Date().toISOString(),
    options,
    laneWasBusyInEveryCandidateRun: laneBusy,
    noiseControlsInCandidate: options.noiseControls,
    noiseFailOpenInCandidate: candidate.reduce<Record<string, number>>((sum, sample) => {
      for (const [reason, value] of Object.entries(sample.noiseFailOpen))
        sum[reason] = (sum[reason] ?? 0) + value;
      return sum;
    }, {}),
    noiseDecisionsInCandidate: candidate.reduce((sum, sample) => sum + sample.noiseDecisions, 0),
    node: process.version,
    pagingBackpressureBypassed: true,
    totalFailures,
    gate,
    summary,
    rawCounts,
    samples,
    interpretation:
      'Verdicts compare paired repetitions against measured baseline noise. NO_DETECTABLE_DIFFERENCE means the ' +
      'difference is within noise, not that it is zero. The gate judges the median paired difference in absolute ' +
      'milliseconds against the ingestion contract. Treat results from shared or loaded hosts as indicative only.',
  };
  const path =
    options.output ??
    `reports/intelligence-ingestion-ab/${report.generatedAt.replace(/[:.]/g, '-')}.json`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(report, null, 2) + '\n');

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
  console.log(
    `Gate: p50 ${p50DeltaMs >= 0 ? '+' : ''}${p50DeltaMs.toFixed(2)} ms (limit +${options.maxP50DeltaMs}), ` +
      `p99 ${p99DeltaMs >= 0 ? '+' : ''}${p99DeltaMs.toFixed(2)} ms (limit +${options.maxP99DeltaMs}) → ${gate.passed ? 'PASS' : 'FAIL'}`
  );
  for (const breach of breaches) console.log(`  breach: ${breach}`);
  await disconnectNoiseLookupClient();
  await prisma.$disconnect();
  if (options.gate && !gate.passed) process.exitCode = 1;
}

main().catch(async error => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
