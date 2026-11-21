import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Prisma } from '@prisma/client';
import prisma from '../../src/lib/prisma';
import { indexIncident } from '../../src/lib/intelligence/jobs/indexer';
import { withDbBudget } from '../../src/lib/intelligence/jobs/db-budget';
import { normalizeAlertShape } from '../../src/lib/alerts/normalization';
import { percentile } from './helpers/ab-stats';
import {
  assertLocalIntelligenceBenchmark,
  ensureIntelligenceHistory,
  historyId,
  INTELLIGENCE_HISTORY_PREFIX,
  INTELLIGENCE_ALERT_HISTORY_PREFIX,
} from './helpers/intelligence-history';

const read = (name: string, fallback: number) => {
  const at = process.argv.indexOf(`--${name}`);
  const value = at < 0 ? fallback : Number(process.argv[at + 1]);
  if (!Number.isInteger(value) || value < 1) throw new Error(`Invalid ${name}`);
  return value;
};
async function main() {
  assertLocalIntelligenceBenchmark();
  const history = read('history', 1000000),
    alerts = read('alerts', 5000),
    samples = read('samples', 20);
  const outputAt = process.argv.indexOf('--output');
  const output = outputAt < 0 ? 'reports/intelligence-foundation.json' : process.argv[outputAt + 1];
  const services = await Promise.all(
    Array.from({ length: 4 }, (_, i) =>
      prisma.service.upsert({
        where: { name: `ab-service-${i}` },
        update: {},
        create: { name: `ab-service-${i}` },
      })
    )
  );
  const rows = await ensureIntelligenceHistory(
    history,
    services.map(row => row.id)
  );
  const targetService = await prisma.service.upsert({
    where: { name: 'intelligence-foundation-sparse-service' },
    update: {},
    create: { name: 'intelligence-foundation-sparse-service' },
  });
  const incident = await prisma.incident.create({
    data: { title: 'Database pool exhausted', serviceId: targetService.id, urgency: 'LOW' },
  });
  const payload = {
    summary: 'Database pool exhausted',
    severity: 'warning',
    custom_details: { environment: 'prod', component: 'checkout' },
  };
  const metadata = normalizeAlertShape(payload);
  await prisma.alert.createMany({
    data: Array.from({ length: alerts }, (_, i) => ({
      incidentId: incident.id,
      serviceId: targetService.id,
      payload,
      ...metadata,
      createdAt: new Date(Date.now() - 60000 + i),
    })),
  });
  const bootstrapAt = performance.now();
  await withDbBudget({ maxDbMs: 2000 }, tx => indexIncident(incident.id, tx));
  const bootstrapMs = performance.now() - bootstrapAt;
  const timings: number[] = [];
  for (let i = 0; i < samples; i++) {
    await prisma.alert.create({
      data: { incidentId: incident.id, serviceId: targetService.id, payload, ...metadata },
    });
    const started = performance.now();
    await withDbBudget({ maxDbMs: 2000 }, tx => indexIncident(incident.id, tx));
    timings.push(performance.now() - started);
  }
  const plans = {
    alertContentLookup: await prisma.$queryRaw(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      SELECT "incidentId" FROM "Alert" WHERE "serviceId" = ${services[0].id}
        AND "fingerprintHash" = ${metadata.fingerprintHash} AND "incidentId" IS NOT NULL
        AND "createdAt" >= now() - interval '5 minutes' ORDER BY "createdAt" DESC, id DESC LIMIT 50`),
    alertModifiedCursor: await prisma.$queryRaw(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      SELECT id FROM "Alert" WHERE "incidentId" = ${incident.id} AND "updatedAt" > now() - interval '1 second'
      ORDER BY "updatedAt", id LIMIT 250`),
    historicalFingerprint: await prisma.$queryRaw(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      SELECT "incidentId" FROM "IncidentFingerprint" WHERE "serviceId" = ${services[0].id}
      ORDER BY "incidentCreatedAt" DESC LIMIT 50`),
    sparseHistoricalFingerprint:
      await prisma.$queryRaw(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      SELECT "incidentId" FROM "IncidentFingerprint" WHERE "serviceId" = ${targetService.id}
      ORDER BY "incidentCreatedAt" DESC LIMIT 50`),
  };
  const [database] = await prisma.$queryRaw<
    Array<{ fsync: string; synchronous_commit: string; full_page_writes: string; version: string }>
  >`
    SELECT current_setting('fsync') AS fsync, current_setting('synchronous_commit') AS synchronous_commit,
      current_setting('full_page_writes') AS full_page_writes, version() AS version`;
  const indexes = (value: unknown): string[] => {
    if (!value || typeof value !== 'object') return [];
    return Object.entries(value).flatMap(([key, child]) =>
      key === 'Index Name' && typeof child === 'string' ? [child] : indexes(child)
    );
  };
  const indexesUsed = Object.fromEntries(
    Object.entries(plans).map(([key, value]) => [key, indexes(value)])
  );
  const expectedIndexes = {
    alertContentLookup: ['idx_alert_service_fingerprint_recent'],
    alertModifiedCursor: ['idx_alert_incident_modified'],
    historicalFingerprint: [
      'idx_incident_fingerprint_service_recent',
      'idx_incident_fingerprint_retention',
    ],
    sparseHistoricalFingerprint: ['idx_incident_fingerprint_service_recent'],
  };
  const requiredIndexesUsed = Object.entries(expectedIndexes).every(([key, names]) =>
    names.some(name => indexesUsed[key]?.includes(name))
  );
  const historyCounts = {
    incidents: rows,
    alerts: await prisma.alert.count({
      where: { id: { startsWith: INTELLIGENCE_ALERT_HISTORY_PREFIX } },
    }),
    fingerprints: await prisma.incidentFingerprint.count({
      where: { incidentId: { startsWith: INTELLIGENCE_HISTORY_PREFIX } },
    }),
  };
  const durable =
    database.fsync === 'on' &&
    database.synchronous_commit === 'on' &&
    database.full_page_writes === 'on';
  const report = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    database,
    historyIncidents: rows,
    historyFixtureExample: historyId(1),
    historyCacheState: 'real normalized fingerprints; lazy input/cursor caches not precomputed',
    alertsBeforeMeasurement: alerts,
    samples,
    bootstrapMs,
    incremental: {
      p50Ms: percentile(timings, 0.5),
      p99Ms: percentile(timings, 0.99),
      maxMs: Math.max(...timings),
    },
    targetP99Ms: 200,
    passed:
      percentile(timings, 0.99) < 200 &&
      requiredIndexesUsed &&
      durable &&
      Object.values(historyCounts).every(value => value >= history),
    historyCounts,
    durable,
    indexesUsed,
    expectedIndexes,
    requiredIndexesUsed,
    timingsMs: timings,
    plans,
    limitation:
      'Local shared host; indexing benchmark only. Not the full OFF/SHADOW/ON ingestion release gate.',
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify({
      historyIncidents: rows,
      bootstrapMs,
      incremental: report.incremental,
      passed: report.passed,
      report: output,
    })
  );
  if (!report.passed) process.exitCode = 1;
}
main()
  .catch(() => {
    console.error(
      'Foundation benchmark failed; inspect the isolated database and benchmark configuration.'
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
