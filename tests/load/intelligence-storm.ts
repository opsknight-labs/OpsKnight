/**
 * Storm benchmark for the intelligence lane: how long does a burst of new incidents take to analyse on top
 * of a large history, and what does each kind of work cost?
 *
 * It seeds `--history` already-indexed incidents spread over `--services` services and 180 days, then drops
 * `--burst` new incidents at once (an alert storm), queues them exactly as discovery would, and runs lane
 * cycles in this process until the queue is empty. It reports the drain time, throughput and per-kind
 * latency percentiles of the real handlers (indexing, similarity, correlation, response analysis).
 *
 * It is also a release gate: the burst must drain within `--max-drain-seconds` (600 by default, the contract
 * for 10k over 1M), with no dead letters or failed items and every kind's p99 under `--max-kind-p99-ms`;
 * otherwise the process exits 1. `--no-gate` records without judging.
 *
 * Usage (dedicated database whose name ends in _bench or _test; the script truncates incident data):
 *   DATABASE_URL=postgresql://.../opsknight_bench \
 *   npx ts-node -r tsconfig-paths/register --project tsconfig.script.json \
 *     tests/load/intelligence-storm.ts --history 200000 --burst 10000 --services 50 \
 *     [--max-drain-seconds 600] [--max-kind-p99-ms 10000] [--output reports/storm.json] [--no-gate]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import prisma from '../../src/lib/prisma';
import {
  DEFAULT_POLICY_DEFINITION,
  INTELLIGENCE_ENGINE_VERSION,
  INTELLIGENCE_SETTINGS_DEFAULTS,
} from '../../src/lib/intelligence/contract';
import {
  DEFAULT_HANDLERS,
  createLaneState,
  runIntelligenceCycle,
  type WorkHandlers,
} from '../../src/lib/intelligence/jobs/runner';
import { enqueueWorkItems, type WorkKind } from '../../src/lib/intelligence/jobs/work-queue';
import { percentile } from './helpers/ab-stats';

interface Options {
  history: number;
  burst: number;
  services: number;
  batchSize: number;
  concurrency: number;
  reuseHistory: boolean;
  maxDrainSeconds: number;
  maxKindP99Ms: number;
  gate: boolean;
  output: string | null;
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
  return {
    history: read('history', 200_000),
    burst: read('burst', 10_000),
    services: read('services', 50),
    batchSize: read('batch-size', 50),
    concurrency: read('concurrency', 8),
    reuseHistory: argv.includes('--reuse-history'),
    maxDrainSeconds: read('max-drain-seconds', 600),
    maxKindP99Ms: read('max-kind-p99-ms', 10_000),
    gate: !argv.includes('--no-gate'),
    output: outputAt >= 0 ? argv[outputAt + 1] : null,
  };
}

// A small vocabulary with a realistic skew: a few words appear everywhere, most are rare.
const COMMON = ['error', 'high', 'service', 'failed', 'alert'];
const NOUNS = [
  'latency',
  'database',
  'connection',
  'disk',
  'memory',
  'cpu',
  'queue',
  'cache',
  'certificate',
  'replica',
  'checkout',
  'payment',
  'login',
  'search',
  'upload',
  'webhook',
  'scheduler',
  'gateway',
  'dns',
  'kafka',
];
const QUALIFIERS = [
  'timeout',
  'saturation',
  'spike',
  'exhausted',
  'unreachable',
  'degraded',
  'lag',
  'expired',
  'refused',
  'throttled',
  'corrupted',
  'stalled',
];

async function seed(options: Options) {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!/_(bench|test)$/.test(url.pathname))
    throw new Error('Refusing to run: database name must end in _bench or _test');
  if (options.reuseHistory) {
    const count = await prisma.incident.count({ where: { id: { startsWith: 'hist-' } } });
    const fingerprints = await prisma.incidentFingerprint.count({
      where: { incidentId: { startsWith: 'hist-' }, engineVersion: INTELLIGENCE_ENGINE_VERSION },
    });
    if (count !== options.history || fingerprints !== options.history)
      throw new Error('Reusable history must match size and engine version');
    await prisma.incident.deleteMany({ where: { id: { startsWith: 'storm-' } } });
    await prisma.$executeRawUnsafe(
      `TRUNCATE "IntelligenceWorkItem", "CorrelationGroup", "IntelligenceCursor" CASCADE`
    );
  } else {
    await prisma.$executeRawUnsafe(
      `TRUNCATE "Incident", "IntelligenceWorkItem", "CorrelationGroup", "IntelligenceCursor" CASCADE`
    );
  }
  await prisma.$executeRawUnsafe(`DELETE FROM "IntelligencePolicyVersion"`);
  await prisma.$executeRawUnsafe(`DELETE FROM "IntelligencePolicy"`);
  await prisma.$executeRawUnsafe(`DELETE FROM "IntelligenceSettings"`);
  await prisma.intelligencePattern.deleteMany({});
  if (!options.reuseHistory)
    await prisma.$executeRawUnsafe(`DELETE FROM "Service" WHERE "id" LIKE 'storm-%'`);

  await prisma.$executeRaw`
    INSERT INTO "Service" ("id", "name", "updatedAt")
    SELECT 'storm-' || g, 'Storm service ' || g, now() FROM generate_series(1, ${options.services}::int) g ON CONFLICT (id) DO NOTHING`;

  const vocabulary = (alias: string) => `
    (ARRAY[${COMMON.map(w => `'${w}'`).join(',')}])[1 + (hashint4(${alias}) & 2147483647) % ${COMMON.length}] || ' ' ||
    (ARRAY[${NOUNS.map(w => `'${w}'`).join(',')}])[1 + (hashint4(${alias} * 7) & 2147483647) % ${NOUNS.length}] || ' ' ||
    (ARRAY[${QUALIFIERS.map(w => `'${w}'`).join(',')}])[1 + (hashint4(${alias} * 13) & 2147483647) % ${QUALIFIERS.length}] ||
    ' on node-' || (${alias} % 97)`;

  // Commit history in bounded batches. The production SLA trigger updates one daily counter per
  // incident; a million updates of that row in one transaction makes fixture setup quadratic.
  // Keep all production triggers enabled and measure seeding separately from queue processing.
  for (let offset = 0; offset < (options.reuseHistory ? 0 : options.history); offset += 2000) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO "Incident" ("id", "title", "serviceId", "status", "urgency", "createdAt", "updatedAt", "resolvedAt")
      SELECT 'hist-' || g, ${vocabulary('g')}, 'storm-' || (1 + g % ${options.services}), 'RESOLVED', 'LOW',
             now() - ((g % 259200) || ' minutes')::interval - interval '1 day', now(),
             now() - ((g % 259200) || ' minutes')::interval - interval '1 day' + interval '20 minutes'
      FROM generate_series(${offset + 1}, ${Math.min(offset + 2000, options.history)}) g`);
    if (offset % 100000 === 0)
      console.log(`Seeded ${Math.min(offset + 2000, options.history)} history incidents`);
  }
  await prisma.$transaction(
    async bulk => {
      await bulk.$executeRawUnsafe(`SET LOCAL statement_timeout = 0`);
      if (!options.reuseHistory)
        await bulk.$executeRawUnsafe(`
      INSERT INTO "IncidentFingerprint" ("incidentId", "serviceId", "template", "templateHash", "tokens", "labels",
                                         "engineVersion", "incidentCreatedAt", "resolvedAt", "updatedAt")
      SELECT i."id", i."serviceId", regexp_replace(lower(i."title"), '[0-9]+', '<num>', 'g'),
             left(encode(sha256(convert_to(regexp_replace(lower(i."title"), '[0-9]+', '<num>', 'g'), 'UTF8')), 'hex'), 32),
             regexp_split_to_array(regexp_replace(lower(i."title"), ' on node-[0-9]+', ''), ' '),
             '{}'::jsonb, '${INTELLIGENCE_ENGINE_VERSION}', i."createdAt", i."resolvedAt", now()
      FROM "Incident" i WHERE i."id" LIKE 'hist-%'`);
      await bulk.$executeRawUnsafe(`ANALYZE "Incident"`);
      await bulk.$executeRawUnsafe(`ANALYZE "IncidentFingerprint"`);

      // The storm: all at once, in the last minute.
      await bulk.$executeRawUnsafe(`
      INSERT INTO "Incident" ("id", "title", "serviceId", "status", "urgency", "createdAt", "updatedAt")
      SELECT 'storm-' || g, ${vocabulary('(g + 7919)')}, 'storm-' || (1 + g % ${options.services}), 'OPEN', 'LOW',
             now() - interval '1 minute' + (g || ' milliseconds')::interval, now()
      FROM generate_series(1, ${options.burst}) g`);
    },
    { timeout: 60 * 60_000, maxWait: 60_000 }
  );

  const admin = await prisma.user.upsert({
    where: { email: 'storm-bench@example.com' },
    update: {},
    create: { email: 'storm-bench@example.com', name: 'Bench', role: 'ADMIN', status: 'ACTIVE' },
  });
  const policy = await prisma.intelligencePolicy.create({
    data: { scopeKey: 'global', headVersion: 1 },
  });
  await prisma.intelligencePolicyVersion.create({
    data: {
      policyId: policy.id,
      version: 1,
      mode: 'SHADOW',
      createdById: admin.id,
      definition: {
        ...DEFAULT_POLICY_DEFINITION,
        correlation: {
          criticalBypass: true,
          rules: [
            {
              id: 'storm-template',
              kind: 'CONTENT_TEMPLATE',
              enabled: true,
              keys: [],
              windowSeconds: 900,
              maxWindowSeconds: 3600,
              minScore: 0.8,
            },
          ],
        },
      },
    },
  });
  await prisma.intelligenceSettings.create({
    data: {
      id: 'default',
      ...INTELLIGENCE_SETTINGS_DEFAULTS,
      enabled: true,
      batchSize: options.batchSize,
      maxConcurrency: options.concurrency,
      maxJobMs: 30_000,
      maxDbMs: 10_000,
      lookbackDays: 180,
    },
  });
}

function timed(samples: Map<string, number[]>): WorkHandlers {
  return Object.fromEntries(
    Object.entries(DEFAULT_HANDLERS).map(([kind, handler]) => [
      kind,
      async (...args: Parameters<NonNullable<WorkHandlers[WorkKind]>>) => {
        const started = performance.now();
        try {
          await handler!(...args);
        } finally {
          const list = samples.get(kind) ?? [];
          list.push(performance.now() - started);
          samples.set(kind, list);
        }
      },
    ])
  ) as WorkHandlers;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const seedStarted = performance.now();
  await seed(options);
  const seedSeconds = (performance.now() - seedStarted) / 1000;

  const storm = await prisma.incident.findMany({
    where: { id: { startsWith: 'storm-' } },
    select: { id: true },
  });
  await enqueueWorkItems(
    storm.map(row => ({ kind: 'INDEX_INCIDENT' as const, subjectKey: row.id }))
  );

  const samples = new Map<string, number[]>();
  const handlers = timed(samples);
  const state = createLaneState();
  // Skip the periodic sweeps; this measures the work queue itself.
  Object.assign(state, {
    lastReconcileAt: Date.now(),
    lastUpdatedRepairAt: Date.now(),
    lastRetentionAt: Date.now(),
    lastObserveAt: Date.now(),
    lastEmbedAt: Date.now(),
    lastDigestCheckAt: Date.now(),
  });

  const started = performance.now();
  let cycles = 0;
  let failed = 0;
  for (;;) {
    // A 1M-history run can exceed a sweep interval. Keep sweeps disabled on every cycle so
    // this benchmark continues to measure the queued burst rather than a history backfill.
    Object.assign(state, {
      lastReconcileAt: Date.now(),
      lastUpdatedRepairAt: Date.now(),
      lastRetentionAt: Date.now(),
      lastObserveAt: Date.now(),
      lastEmbedAt: Date.now(),
      lastDigestCheckAt: Date.now(),
    });
    const result = await runIntelligenceCycle(state, { handlers, getCriticalLagMs: async () => 0 });
    cycles += 1;
    failed += result.failed;
    if (
      result.claimed === 0 &&
      (await prisma.intelligenceWorkItem.count({ where: { attempts: { lt: 8 } } })) === 0
    )
      break;
  }
  const drainSeconds = (performance.now() - started) / 1000;

  const perKind = Object.fromEntries(
    [...samples.entries()].map(([kind, values]) => [
      kind,
      {
        count: values.length,
        p50Ms: Math.round(percentile(values, 0.5) * 10) / 10,
        p95Ms: Math.round(percentile(values, 0.95) * 10) / 10,
        p99Ms: Math.round(percentile(values, 0.99) * 10) / 10,
      },
    ])
  );
  const [findings, groups, deadLetters] = await Promise.all([
    prisma.intelligenceFinding.count({ where: { status: 'ACTIVE' } }),
    prisma.correlationGroup.count(),
    prisma.intelligenceWorkItem.count({ where: { attempts: { gte: 8 } } }),
  ]);
  // Share of wall time spent inside handlers at the configured concurrency: low values point at
  // per-cycle overhead or host contention rather than at the analysis itself.
  const handlerMs = [...samples.values()].flat().reduce((sum, value) => sum + value, 0);
  const handlerBusyFraction =
    Math.round((handlerMs / (drainSeconds * 1000 * options.concurrency)) * 1000) / 1000;
  const breaches: string[] = [];
  if (drainSeconds > options.maxDrainSeconds)
    breaches.push(`drained in ${drainSeconds.toFixed(1)} s > ${options.maxDrainSeconds} s`);
  if (deadLetters > 0) breaches.push(`${deadLetters} dead letters`);
  if (failed > 0) breaches.push(`${failed} failed item attempts`);
  for (const [kind, stats] of Object.entries(perKind))
    if (stats.p99Ms > options.maxKindP99Ms)
      breaches.push(`${kind} p99 ${stats.p99Ms} ms > ${options.maxKindP99Ms} ms`);
  const gate = {
    contract: { maxDrainSeconds: options.maxDrainSeconds, maxKindP99Ms: options.maxKindP99Ms },
    breaches,
    passed: breaches.length === 0,
  };
  const report = {
    measuredAt: new Date().toISOString(),
    node: process.version,
    engineVersion: INTELLIGENCE_ENGINE_VERSION,
    options,
    seedSeconds: Math.round(seedSeconds),
    drainSeconds: Math.round(drainSeconds * 10) / 10,
    incidentsPerSecond: Math.round((options.burst / drainSeconds) * 10) / 10,
    cycles,
    averageCycleMs: Math.round((drainSeconds * 1000) / Math.max(1, cycles)),
    handlerBusyFraction,
    failedItems: failed,
    deadLetters,
    activeFindings: findings,
    correlationGroups: groups,
    perKind,
    gate,
    note: 'Single process, local PostgreSQL. Indicative only; certification needs dedicated hardware.',
  };
  const path =
    options.output ?? `artifacts/load-certification/intelligence/storm-${Date.now()}.json`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  await prisma.$disconnect();
  if (options.gate && !gate.passed) process.exitCode = 1;
}

main().catch(async error => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
