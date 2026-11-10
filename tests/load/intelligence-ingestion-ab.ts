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
 *     [--max-p99-delta-ms 10] [--max-p50-delta-ms 2] [--output reports/ingestion-ab.json] [--no-gate] \
 *     [--lane-mode thread|in-process]
 *
 * `--lane-mode thread` (the default) runs the candidate's lane in a worker thread started by the production
 * host (lane-thread.ts), as an `integrated` process does; `in-process` runs it on the ingestion thread.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { Session } from 'node:inspector';
import { cpus, loadavg } from 'node:os';
import { dirname, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { monitorEventLoopDelay, performance, PerformanceObserver } from 'node:perf_hooks';
import prisma from '../../src/lib/prisma';
import { processEvent, type EventPayload } from '../../src/lib/events';
import {
  DEFAULT_POLICY_DEFINITION,
  INTELLIGENCE_SETTINGS_DEFAULTS,
} from '../../src/lib/intelligence/contract';
import {
  DEFAULT_HANDLERS,
  createLaneState,
  getIntelligenceLaneStatus,
  runIntelligenceCycle,
  type WorkHandlers,
} from '../../src/lib/intelligence/jobs/runner';
import { enqueueWorkItems, type WorkKind } from '../../src/lib/intelligence/jobs/work-queue';
import { resolveLanePool } from '../../src/lib/intelligence/jobs/lane-pool';
import {
  laneThreadWorker,
  startIntelligenceLaneThread,
  stopIntelligenceLaneThread,
} from '../../src/lib/intelligence/jobs/lane-thread';
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
import { waitForQuietHost, watchHost } from './helpers/host-validity';
import { laneWorkInBurstMs } from './helpers/lane-busy';

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
  /** When set, a V8 CPU profile of each timed burst (not warm-up or seeding) is written here. */
  cpuProfileDir: string | null;
  /**
   * Diagnosis only: `--no-lane-yield` runs the lane without backing off while ingestion is busy, to
   * measure what the yield is worth. Not valid for the release gate (the script refuses to gate with it).
   */
  laneYield: boolean;
  /**
   * Where the candidate's lane runs: `thread` (default; the production `integrated` default, a worker
   * thread started by lane-thread.ts) or `in-process` (on the ingestion thread, as before the thread).
   */
  laneMode: 'thread' | 'in-process';
  /** Wait up to this long for a quiet host (load and other heavy processes) before the first arm. */
  waitForQuietMs: number;
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
  /**
   * Handlers that ran at some point during the burst (started before it ended and not finished before it
   * began), completed or not. Reported for context; the gate still requires completed items.
   */
  laneItemsActive: number;
  /** Wall time inside the timed burst with at least one lane handler running. */
  laneWorkInBurstMs: number;
  /** The same as a share of the burst's wall time. */
  laneBusyFraction: number;
  diagnostics: BurstDiagnostics;
}

/**
 * Attribution data for the timed burst, so a regression can be traced to its cause rather than guessed:
 * event-loop blocking (CPU work sharing the thread), Prisma pool queueing (work waiting for a pooled
 * connection) and what the database backends were waiting on.
 */
interface BurstDiagnostics {
  eventLoopDelayMs: { p50: number; p99: number; max: number; mean: number };
  /** Share of wall time the main thread was busy (0..1), and process CPU per wall second. */
  eventLoopUtilization: number;
  processCpuPerSec: number;
  /** Garbage collection pauses on the main thread during the burst (major = mark-compact). */
  gc: { totalMs: number; majorMs: number; majorCount: number };
  /** Prisma engine pool: queries that waited for a connection during the burst and how long in total. */
  poolWait: { queries: number; totalMs: number; meanMs: number; peakWaiting: number };
  /**
   * Statements on the process (ingestion) pool, as timed by the Prisma engine: if these grow, the time is
   * spent in PostgreSQL or the engine; if not, it is spent waiting on this process. When the lane shares
   * that pool its statements are included too.
   */
  primaryStatements: { count: number; p50Ms: number; p99Ms: number; perEventMs: number };
  /** Sum over 50 ms samples of backends in each wait state (type:event), for this database. */
  waitEvents: Record<string, number>;
  /**
   * Latency by when the event started: p50/p99 of the first, middle and last third of the burst, so
   * contention that only hits the start of a burst (before the lane notices it) can be told apart.
   */
  phases?: { p50Ms: number; p99Ms: number }[];
  /** Lane handlers that overlapped the burst: start and end offsets from the burst start, in ms. */
  laneSpans?: { startMs: number; endMs: number | null }[];
  /** Thread lane: time it spent yielding to ingestion during the burst and its cycle outcomes. */
  laneYield?: { pausedMs: number; cycles: Record<string, number> };
}

interface PoolSnapshot {
  waitCount: number;
  waitSumMs: number;
}

async function poolSnapshot(): Promise<PoolSnapshot> {
  try {
    const metrics = await prisma.$metrics.json();
    const histogram = metrics.histograms.find(
      metric => metric.key === 'prisma_client_queries_wait_histogram_ms'
    )?.value;
    return { waitCount: histogram?.count ?? 0, waitSumMs: histogram?.sum ?? 0 };
  } catch {
    return { waitCount: 0, waitSumMs: 0 };
  }
}

type QueryEvent = { duration: number; query: string };
const statementSink: { durations: number[] | null } = { durations: null };
let statementListener = false;

/** Listens on the process pool only; the lane's own pool (when it has one) is a different client. */
function listenToPrimaryStatements() {
  if (statementListener) return;
  statementListener = true;
  const primary = globalThis.prismaGlobal as unknown as
    { $on(event: 'query', callback: (event: QueryEvent) => void): void } | undefined;
  primary?.$on('query', event => {
    if (!statementSink.durations || event.query.includes('pg_stat_activity')) return;
    statementSink.durations.push(event.duration);
  });
}

async function samplePoolWaiting(stop: { done: boolean }) {
  let peak = 0;
  while (!stop.done) {
    try {
      const metrics = await prisma.$metrics.json();
      const waiting = metrics.gauges.find(g => g.key === 'prisma_client_queries_wait')?.value ?? 0;
      peak = Math.max(peak, waiting);
    } catch {
      // Metrics unavailable: report zero rather than invent pressure.
    }
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  return peak;
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
    laneYield: !argv.includes('--no-lane-yield'),
    laneMode: (() => {
      const at = argv.indexOf('--lane-mode');
      const value = at >= 0 ? argv[at + 1] : 'thread';
      if (value !== 'thread' && value !== 'in-process')
        throw new Error('--lane-mode must be thread or in-process');
      return value;
    })(),
    waitForQuietMs: argv.includes('--wait-for-quiet-ms')
      ? Math.max(0, Number(argv[argv.indexOf('--wait-for-quiet-ms') + 1]) || 0)
      : 0,
    cpuProfileDir: argv.includes('--cpu-profile-dir')
      ? argv[argv.indexOf('--cpu-profile-dir') + 1]
      : null,
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
  const waitEvents: Record<string, number> = {};
  while (!stop.done) {
    const rows = await prisma.$queryRaw<
      Array<{ wait: string; state: string | null; backends: bigint }>
    >`
      SELECT coalesce(wait_event_type || ':' || wait_event, 'CPU') AS wait, state, count(*)::bigint AS backends
      FROM pg_stat_activity
      WHERE datname = current_database() AND pid <> pg_backend_pid()
        AND state IN ('active', 'idle in transaction')
      GROUP BY 1, 2`;
    let waiting = 0;
    let active = 0;
    for (const row of rows) {
      const count = Number(row.backends);
      if (row.wait.startsWith('Lock:')) waiting += count;
      if (row.state === 'active') active += count;
      const key = `${row.state === 'active' ? '' : 'idle-in-tx '}${row.wait}`;
      waitEvents[key] = (waitEvents[key] ?? 0) + count;
    }
    peakLockWaiters = Math.max(peakLockWaiters, waiting);
    // The sampler's own backend is excluded above; count it like the previous version did.
    peakActiveBackends = Math.max(peakActiveBackends, active + 1);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return { peakLockWaiters, peakActiveBackends, waitEvents };
}

/** Profiles only the timed window, so module loading, seeding and warm-up never appear in it. */
async function profileWindow<T>(path: string | null, work: () => Promise<T>): Promise<T> {
  if (!path) return work();
  const session = new Session();
  session.connect();
  const post = (method: string, params?: object) =>
    new Promise<unknown>((resolve, reject) =>
      session.post(method, params ?? {}, (error, result) =>
        error ? reject(error) : resolve(result)
      )
    );
  await post('Profiler.enable');
  await post('Profiler.setSamplingInterval', { interval: 250 });
  await post('Profiler.start');
  try {
    return await work();
  } finally {
    const { profile } = (await post('Profiler.stop')) as { profile: unknown };
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(profile));
    session.disconnect();
  }
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

function burstPhases(timeline: { at: number; ms: number }[]) {
  const ordered = [...timeline].sort((a, b) => a.at - b.at);
  const third = Math.ceil(ordered.length / 3);
  return [0, 1, 2].map(index => {
    const values = ordered.slice(index * third, (index + 1) * third).map(entry => entry.ms);
    return { p50Ms: percentile(values, 0.5), p99Ms: percentile(values, 0.99) };
  });
}

async function runBurst(serviceIds: string[], options: Options, tag: string) {
  const latencies: number[] = [];
  const timeline: { at: number; ms: number }[] = [];
  let failures = 0;
  let next = 0;
  const stopSampling = { done: false };
  const sampler = sampleDatabase(stopSampling);
  const poolSampler = samplePoolWaiting(stopSampling);
  const poolBefore = await poolSnapshot();
  const loopDelay = monitorEventLoopDelay({ resolution: 1 });
  loopDelay.enable();
  const gc = { totalMs: 0, majorMs: 0, majorCount: 0 };
  const gcObserver = new PerformanceObserver(list => {
    for (const entry of list.getEntries()) {
      gc.totalMs += entry.duration;
      // NODE_PERFORMANCE_GC_MAJOR = 4 (mark-sweep-compact).
      if ((entry as { detail?: { kind?: number } }).detail?.kind === 4) {
        gc.majorMs += entry.duration;
        gc.majorCount += 1;
      }
    }
  });
  gcObserver.observe({ entryTypes: ['gc'] });
  listenToPrimaryStatements();
  const statements: number[] = [];
  statementSink.durations = statements;
  const eluBefore = performance.eventLoopUtilization();
  const cpuBefore = process.cpuUsage();
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
        timeline.push({ at: t0, ms: performance.now() - t0 });
      }
    })
  );
  const ended = performance.now();
  const elapsedSec = (performance.now() - started) / 1000;
  const elu = performance.eventLoopUtilization(eluBefore).utilization;
  const cpu = process.cpuUsage(cpuBefore);
  loopDelay.disable();
  gcObserver.disconnect();
  statementSink.durations = null;
  const poolAfter = await poolSnapshot();
  stopSampling.done = true;
  const { waitEvents, ...db } = await sampler;
  const peakWaiting = await poolSampler;
  const waitQueries = poolAfter.waitCount - poolBefore.waitCount;
  const waitTotalMs = poolAfter.waitSumMs - poolBefore.waitSumMs;
  const ns = (value: number) => (Number.isFinite(value) ? value / 1e6 : 0);
  const diagnostics: BurstDiagnostics = {
    eventLoopDelayMs: {
      p50: ns(loopDelay.percentile(50)),
      p99: ns(loopDelay.percentile(99)),
      max: ns(loopDelay.max),
      mean: ns(loopDelay.mean),
    },
    eventLoopUtilization: elu,
    processCpuPerSec: (cpu.user + cpu.system) / 1e6 / elapsedSec,
    gc,
    poolWait: {
      queries: waitQueries,
      totalMs: waitTotalMs,
      meanMs: waitQueries > 0 ? waitTotalMs / waitQueries : 0,
      peakWaiting,
    },
    primaryStatements: {
      count: statements.length,
      p50Ms: percentile(statements, 0.5),
      p99Ms: percentile(statements, 0.99),
      perEventMs: statements.reduce((sum, value) => sum + value, 0) / Math.max(1, latencies.length),
    },
    waitEvents,
    phases: burstPhases(timeline),
  };
  return { latencies, failures, elapsedSec, started, ended, ...db, diagnostics };
}

/** Keep the candidate busy: this harness publishes paging intents but has no paging delivery worker.
 * Bypass that synthetic backlog's backpressure in the harness only to measure worst-case contention.
 */
function busyCandidate(options: Options) {
  const tracker = {
    completed: 0,
    started: 0,
    finished: 0,
    stop: false,
    spans: [] as { start: number; end: number | null }[],
  };
  const handlers = Object.fromEntries(
    Object.entries(DEFAULT_HANDLERS).map(([kind, handler]) => [
      kind,
      async (...args: Parameters<NonNullable<WorkHandlers[WorkKind]>>) => {
        tracker.started++;
        const span = { start: performance.now(), end: null as number | null };
        tracker.spans.push(span);
        try {
          const result = await handler!(...args);
          tracker.completed++;
          return result;
        } finally {
          tracker.finished++;
          span.end = performance.now();
        }
      },
    ])
  ) as WorkHandlers;
  const state = createLaneState();
  if (!options.laneYield) state.ingestionYield = undefined;
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
    snapshot: async (): Promise<LaneSnapshot> => ({
      completed: tracker.completed,
      started: tracker.started,
      finished: tracker.finished,
      spans: tracker.spans.map(span => ({ ...span })),
    }),
    stop: async () => {
      tracker.stop = true;
      await active;
    },
  };
}

interface LaneSnapshot {
  completed: number;
  started: number;
  finished: number;
  /** On this thread's performance clock. */
  spans: { start: number; end: number | null }[];
  /** Thread lane only: time spent yielding to ingestion and cycle outcomes, cumulative. */
  yieldPausedMs?: number;
  cycleStats?: Record<string, number>;
}

interface CandidateLane {
  snapshot(): Promise<LaneSnapshot>;
  stop(): Promise<void>;
}

const THREAD_BENCH_BUNDLE = 'scripts/dist/intelligence-lane-thread-bench.cjs';
let threadBundle: Promise<string> | null = null;

/** Bundles the bench entry with the production build script (same esbuild settings as the real thread). */
function benchThreadBundle(): Promise<string> {
  threadBundle ??= (async () => {
    const load = new Function('specifier', 'return import(specifier)') as (
      specifier: string
    ) => Promise<{
      buildIntelligenceLaneThread(options: { entry: string; outfile: string }): Promise<string>;
    }>;
    const { buildIntelligenceLaneThread } = await load(
      pathToFileURL(resolvePath('scripts/build-intelligence-lane-thread.mjs')).href
    );
    return buildIntelligenceLaneThread({
      entry: 'tests/load/helpers/intelligence-lane-thread-bench-entry.ts',
      outfile: THREAD_BENCH_BUNDLE,
    });
  })();
  return threadBundle;
}

/** The candidate lane in a worker thread, started and stopped by the production host. */
async function threadCandidate(options: Options): Promise<CandidateLane> {
  const entry = await benchThreadBundle();
  let pending: ((snapshot: LaneSnapshot) => void) | null = null;
  const started = startIntelligenceLaneThread({
    entry,
    workerData: { laneYield: options.laneYield },
    onMessage: message => {
      const report = message as { type?: string } & Partial<LaneSnapshot>;
      if (report.type !== 'bench-tracker' || !pending) return;
      const resolve = pending;
      pending = null;
      resolve({
        completed: report.completed ?? 0,
        started: report.started ?? 0,
        finished: report.finished ?? 0,
        spans: (report.spans ?? []).map(span => ({
          start: span.start - performance.timeOrigin,
          end: span.end === null ? null : span.end - performance.timeOrigin,
        })),
        yieldPausedMs: report.yieldPausedMs,
        cycleStats: report.cycleStats,
      });
    },
  });
  if (!started) throw new Error('Lane thread did not start');
  const empty: LaneSnapshot = { completed: 0, started: 0, finished: 0, spans: [] };
  return {
    snapshot: () =>
      new Promise<LaneSnapshot>(resolve => {
        const worker = laneThreadWorker();
        if (!worker) return resolve(empty);
        pending = resolve;
        worker.postMessage({ type: 'bench-snapshot' });
        setTimeout(() => {
          if (pending === resolve) {
            pending = null;
            resolve(empty);
          }
        }, 5_000).unref();
      }),
    stop: async () => {
      const status = getIntelligenceLaneStatus();
      await stopIntelligenceLaneThread();
      if (status.thread && status.thread.restarts > 0)
        throw new Error(`Lane thread crashed during the run: ${status.thread.lastExit}`);
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

  const lane: CandidateLane | null = laneOn
    ? options.laneMode === 'thread'
      ? await threadCandidate(options)
      : busyCandidate(options)
    : null;
  // Warm connections and caches in both arms so neither pays cold-start cost inside the timed window.
  await runBurst(serviceIds, { ...options, events: 20 }, `warm-${arm}-${repetition}`);
  // The queue length stays flat (indexing chains an analysis item), so progress is read from the
  // lane's own completed-work counter.
  if (lane) {
    const deadline = Date.now() + 30000;
    while ((await lane.snapshot()).completed === 0) {
      if (Date.now() >= deadline) {
        await lane.stop();
        throw new Error('Candidate lane did not become active');
      }
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  }
  const before = lane ? await lane.snapshot() : null;
  const completedBefore = before?.completed ?? 0;
  const failOpenBefore = failOpenCounts();
  const decisionsBefore = await prisma.prePagingDecision.count();
  const finishedBefore = before?.finished ?? 0;
  const burst = await profileWindow(
    options.cpuProfileDir ? `${options.cpuProfileDir}/${arm}-${repetition}.cpuprofile` : null,
    () => runBurst(serviceIds, options, `${arm}-${repetition}`)
  );
  const after = lane ? await lane.snapshot() : null;
  const completedAfter = after?.completed ?? 0;
  if (after) {
    burst.diagnostics.laneSpans = after.spans
      .filter(span => span.start < burst.ended && (span.end === null || span.end > burst.started))
      .map(span => ({
        startMs: Math.round(span.start - burst.started),
        endMs: span.end === null ? null : Math.round(span.end - burst.started),
      }));
  }
  const startedAfter = after?.started ?? 0;
  if (before?.cycleStats && after?.cycleStats) {
    burst.diagnostics.laneYield = {
      pausedMs: Math.round((after.yieldPausedMs ?? 0) - (before.yieldPausedMs ?? 0)),
      cycles: Object.fromEntries(
        Object.entries(after.cycleStats).map(([key, value]) => [
          key,
          value - (before.cycleStats?.[key] ?? 0),
        ])
      ),
    };
  }
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
    laneItemsActive: laneOn ? Math.max(0, startedAfter - finishedBefore) : 0,
    laneWorkInBurstMs: laneOn
      ? laneWorkInBurstMs(burst.diagnostics.laneSpans, burst.elapsedSec)
      : 0,
    laneBusyFraction: laneOn
      ? laneWorkInBurstMs(burst.diagnostics.laneSpans, burst.elapsedSec) /
        Math.max(1, burst.elapsedSec * 1000)
      : 0,
    noiseFailOpen,
    noiseDecisions,
    diagnostics: burst.diagnostics,
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
  if (options.gate && !options.laneYield) {
    throw new Error('--no-lane-yield is a diagnosis mode; combine it with --no-gate.');
  }
  const samples: Sample[] = [];
  const quiet = options.waitForQuietMs > 0 ? await waitForQuietHost(options.waitForQuietMs) : null;
  const loadAtStart = loadavg();
  const hostWatch = watchHost();
  for (let repetition = 0; repetition < options.repetitions; repetition += 1) {
    // Alternate which arm goes first so ordering effects cancel.
    const order: Arm[] =
      repetition % 2 === 0 ? ['baseline', 'candidate'] : ['candidate', 'baseline'];
    for (const arm of order) {
      const sample = await runArm(arm, repetition, options);
      samples.push(sample);
      console.log(
        `rep ${repetition} ${arm.padEnd(9)} p50=${sample.p50Ms.toFixed(1)}ms p99=${sample.p99Ms.toFixed(1)}ms ` +
          `${sample.throughputPerSec.toFixed(0)}/s fail=${sample.failures} lane=${sample.laneItemsProcessed}/${sample.laneItemsActive} ` +
          `elu=${sample.diagnostics.eventLoopUtilization.toFixed(2)} cpu=${sample.diagnostics.processCpuPerSec.toFixed(2)} ` +
          `gc=${sample.diagnostics.gc.totalMs.toFixed(0)}ms major=${sample.diagnostics.gc.majorCount}/${sample.diagnostics.gc.majorMs.toFixed(0)}ms ` +
          `eld p50/p99/max=${sample.diagnostics.eventLoopDelayMs.p50.toFixed(1)}/${sample.diagnostics.eventLoopDelayMs.p99.toFixed(1)}/${sample.diagnostics.eventLoopDelayMs.max.toFixed(1)}ms ` +
          `stmt n/p50/p99/perEvent=${sample.diagnostics.primaryStatements.count}/${sample.diagnostics.primaryStatements.p50Ms}/${sample.diagnostics.primaryStatements.p99Ms}/${sample.diagnostics.primaryStatements.perEventMs.toFixed(1)}ms ` +
          `poolwait mean=${sample.diagnostics.poolWait.meanMs.toFixed(2)}ms total=${sample.diagnostics.poolWait.totalMs.toFixed(0)}ms peak=${sample.diagnostics.poolWait.peakWaiting} ` +
          `thirds p99=${(sample.diagnostics.phases ?? []).map(phase => phase.p99Ms.toFixed(0)).join('/')}ms` +
          (sample.diagnostics.laneSpans
            ? ` laneSpans=${sample.diagnostics.laneSpans.map(span => `${span.startMs}..${span.endMs ?? '?'}`).join(',')}`
            : '') +
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
  const hostValidation = await hostWatch.stop();
  // Busy means lane handlers ran inside the timed burst, not merely that the lane completed something
  // between the snapshots around it (an item started before the burst, or finished after it).
  const laneBusy =
    !options.lane ||
    candidate.every(sample => sample.laneItemsProcessed > 0 && sample.laneWorkInBurstMs > 0);
  const laneBusyFractions = candidate.map(sample => sample.laneBusyFraction);
  const totalFailures = samples.reduce((sum, sample) => sum + sample.failures, 0);
  const p99DeltaMs = medianPairedDelta(samples, sample => sample.p99Ms);
  const p50DeltaMs = medianPairedDelta(samples, sample => sample.p50Ms);
  const breaches: string[] = [];
  if (!(p99DeltaMs <= options.maxP99DeltaMs))
    breaches.push(`p99 +${p99DeltaMs.toFixed(2)} ms > ${options.maxP99DeltaMs} ms`);
  if (!(p50DeltaMs <= options.maxP50DeltaMs))
    breaches.push(`p50 +${p50DeltaMs.toFixed(2)} ms > ${options.maxP50DeltaMs} ms`);
  if (!laneBusy)
    breaches.push(
      'no lane work inside the timed burst of a candidate run (contention not exercised)'
    );
  if (totalFailures > 0) breaches.push(`${totalFailures} ingestion failures`);
  const gate = {
    contract: { maxP99DeltaMs: options.maxP99DeltaMs, maxP50DeltaMs: options.maxP50DeltaMs },
    medianPairedDeltaMs: { p50: p50DeltaMs, p99: p99DeltaMs },
    breaches,
    // A run on a host that was not quiet cannot be judged: it is neither a pass nor a fail.
    status: (!hostValidation.valid ? 'INVALID' : breaches.length === 0 ? 'PASS' : 'FAIL') as
      'PASS' | 'FAIL' | 'INVALID',
    passed: hostValidation.valid && breaches.length === 0,
    invalidReasons: hostValidation.reasons,
  };
  const report = {
    generatedAt: new Date().toISOString(),
    options,
    laneWasBusyInEveryCandidateRun: laneBusy,
    // The candidate is a YIELDING lane: while ingestion is busy the production lane runs one item at a
    // time at a bounded duty cycle. The gate therefore measures ingestion beside a lane that backs off,
    // which is what an integrated node runs; these fractions say how much lane work the burst really saw.
    laneBusyFractionOfBurst: {
      min: laneBusyFractions.length ? Math.min(...laneBusyFractions) : 0,
      median: laneBusyFractions.length
        ? [...laneBusyFractions].sort((a, b) => a - b)[Math.floor(laneBusyFractions.length / 2)]
        : 0,
      perCandidateRun: laneBusyFractions,
    },
    hostValidation,
    hostQuietWait: quiet,
    noiseControlsInCandidate: options.noiseControls,
    noiseFailOpenInCandidate: candidate.reduce<Record<string, number>>((sum, sample) => {
      for (const [reason, value] of Object.entries(sample.noiseFailOpen))
        sum[reason] = (sum[reason] ?? 0) + value;
      return sum;
    }, {}),
    noiseDecisionsInCandidate: candidate.reduce((sum, sample) => sum + sample.noiseDecisions, 0),
    node: process.version,
    // Shared hosts skew both arms; record how loaded this one was so readers can judge the numbers.
    host: { cpus: cpus().length, loadAverageAtStart: loadAtStart, loadAverageAtEnd: loadavg() },
    lane: {
      mode: options.laneMode,
      pool: options.laneMode === 'thread' ? 'thread client' : resolveLanePool(),
      yieldToIngestion: options.laneYield,
    },
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
  console.log(
    `Lane work inside every candidate burst: ${laneBusy} (yielding lane; share of burst wall time ` +
      `${laneBusyFractions.map(fraction => `${(fraction * 100).toFixed(0)}%`).join(', ')}). Report: ${path}`
  );
  console.log(
    `Host: start load ${hostValidation.startLoad1?.toFixed(2)}, peak ${hostValidation.peakLoad1?.toFixed(2)}, ` +
      `max sample gap ${hostValidation.maxSampleGapSec} s → ${hostValidation.valid ? 'VALID' : 'INVALID'}`
  );
  for (const reason of hostValidation.reasons) console.log(`  invalid: ${reason}`);
  if (!laneBusy)
    console.log(
      'WARNING: the lane did no work in some candidate runs; those results do not test contention.'
    );
  console.log(
    `Gate: p50 ${p50DeltaMs >= 0 ? '+' : ''}${p50DeltaMs.toFixed(2)} ms (limit +${options.maxP50DeltaMs}), ` +
      `p99 ${p99DeltaMs >= 0 ? '+' : ''}${p99DeltaMs.toFixed(2)} ms (limit +${options.maxP99DeltaMs}) → ${gate.status}` +
      (gate.status === 'INVALID' ? ' (host not quiet: discard this run and repeat it)' : '')
  );
  for (const breach of breaches) console.log(`  breach: ${breach}`);
  await disconnectNoiseLookupClient();
  await prisma.$disconnect();
  // 1 = contract breached on a quiet host; 2 = the run cannot be judged and must be repeated.
  if (options.gate && !gate.passed) process.exitCode = gate.status === 'INVALID' ? 2 : 1;
}

main().catch(async error => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
