import { Prisma } from '@prisma/client';
import prisma from '../../../src/lib/prisma';
import { normalizeAlertShape } from '../../../src/lib/alerts/normalization';
import { buildIncidentFingerprint } from '../../../src/lib/intelligence/normalization';
import { INTELLIGENCE_ENGINE_VERSION } from '../../../src/lib/intelligence/contract';

export const INTELLIGENCE_HISTORY_PREFIX = 'intel-perf-history-';
export const INTELLIGENCE_ALERT_HISTORY_PREFIX = 'intel-perf-alert-';
export const historyId = (n: number) =>
  `${INTELLIGENCE_HISTORY_PREFIX}${n.toString().padStart(7, '0')}`;

export function assertLocalIntelligenceBenchmark() {
  const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/');
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !/_(test|bench)$/.test(url.pathname)
  )
    throw new Error('A dedicated loopback database ending in _test or _bench is required.');
}

/** Synthetic performance fixtures only. Templates/tokens/labels use the real normalizers. Cursor
 * and analysis caches are intentionally cold, not falsely marked as completed analyses. The fixture
 * creates no embeddings or provider credentials and never runs against a shared/demo database.
 */
export async function ensureIntelligenceHistory(count: number, serviceIds: readonly string[]) {
  assertLocalIntelligenceBenchmark();
  if (!Number.isInteger(count) || count < 0 || count > 1000000 || serviceIds.length < 1)
    throw new Error('Invalid history fixture size.');
  const existing = await prisma.incident.count({
    where: { id: { startsWith: INTELLIGENCE_HISTORY_PREFIX } },
  });
  if (existing >= count) {
    const [alerts, fingerprints] = await Promise.all([
      prisma.alert.count({ where: { id: { startsWith: INTELLIGENCE_ALERT_HISTORY_PREFIX } } }),
      prisma.incidentFingerprint.count({
        where: { incidentId: { startsWith: INTELLIGENCE_HISTORY_PREFIX } },
      }),
    ]);
    if (alerts >= count && fingerprints >= count) return existing;
  }
  const titles = [
    'Database connection pool exhausted on db-primary-1',
    'Checkout HTTP 500 errors after release',
    'Disk space full on storage-node-1',
    'TLS certificate expired for public gateway',
    'Kafka consumer lag above threshold',
    'Redis memory pressure and evictions',
    'Payment gateway request timeout',
    'Search index replication behind leader',
  ];
  const patterns = titles.map((summary, ordinal) => {
    const metadata = normalizeAlertShape({
      summary,
      severity: 'warning',
      custom_details: { environment: 'prod', component: `workload-${ordinal}` },
    });
    const fingerprint = buildIncidentFingerprint({ title: summary, labelSource: metadata.labels });
    const payload = {
      summary,
      severity: 'warning',
      source: 'synthetic-history',
      custom_details: metadata.labels,
    };
    return Prisma.sql`(${ordinal}::int, ${summary}, ${fingerprint.template}, ${fingerprint.tokens}::text[],
      ${JSON.stringify(metadata.labels)}::jsonb, ${metadata.fingerprintHash}, ${JSON.stringify(payload)}::jsonb)`;
  });
  const patternCte = Prisma.sql`patterns(ordinal, title, template, tokens, labels, fingerprint_hash, payload) AS (VALUES ${Prisma.join(patterns)})`;
  for (let first = 1; first <= count; first += 10000) {
    const last = Math.min(count, first + 9999);
    await prisma.$transaction(
      async tx => {
        await tx.$executeRaw(Prisma.sql`
        WITH ${patternCte}, source AS (
          SELECT n, (ARRAY[${Prisma.join(serviceIds)}]::text[])[(((n - 1) / 8) % ${serviceIds.length} + 1)::int] AS service_id,
            now() - interval '1 day' - make_interval(secs => (n % 2592000)::int) AS at
          FROM generate_series(${first}::int, ${last}::int) n
        ) INSERT INTO "Incident" (id, title, "serviceId", status, urgency, "createdAt", "updatedAt", "acknowledgedAt", "resolvedAt")
        SELECT ${INTELLIGENCE_HISTORY_PREFIX} || lpad(n::text, 7, '0'), p.title, service_id, 'RESOLVED', 'LOW',
          at, at + interval '5 minutes', at + interval '1 minute', at + interval '5 minutes'
        FROM source JOIN patterns p ON p.ordinal = (n - 1) % 8 ON CONFLICT (id) DO NOTHING`);
        await tx.$executeRaw(Prisma.sql`
        WITH ${patternCte}
        INSERT INTO "Alert" (id, "incidentId", "serviceId", status, payload, severity, labels, "fingerprintHash", "createdAt", "updatedAt")
        SELECT ${INTELLIGENCE_ALERT_HISTORY_PREFIX} || substring(i.id FROM ${INTELLIGENCE_HISTORY_PREFIX.length + 1}::int),
          i.id, i."serviceId", 'RESOLVED', p.payload, 'warning', p.labels, p.fingerprint_hash, i."createdAt", i."updatedAt"
        FROM "Incident" i JOIN patterns p ON p.ordinal = (substring(i.id FROM ${INTELLIGENCE_HISTORY_PREFIX.length + 1}::int)::int - 1) % 8
        WHERE i.id >= ${historyId(first)} AND i.id <= ${historyId(last)} ON CONFLICT (id) DO NOTHING`);
        await tx.$executeRaw(Prisma.sql`
        WITH ${patternCte}
        INSERT INTO "IncidentFingerprint" ("incidentId", "serviceId", template, "templateHash", tokens, labels, "engineVersion",
          "incidentCreatedAt", "resolvedAt", "sourceUpdatedAt", "resolutionSummary", "createdAt", "updatedAt")
        SELECT i.id, i."serviceId", p.template, p.fingerprint_hash, p.tokens, p.labels, ${INTELLIGENCE_ENGINE_VERSION},
          i."createdAt", i."resolvedAt", i."updatedAt", 'Restored normal operation.', now(), now()
        FROM "Incident" i JOIN patterns p ON p.ordinal = (substring(i.id FROM ${INTELLIGENCE_HISTORY_PREFIX.length + 1}::int)::int - 1) % 8
        WHERE i.id >= ${historyId(first)} AND i.id <= ${historyId(last)} ON CONFLICT ("incidentId") DO NOTHING`);
      },
      { maxWait: 5000, timeout: 60000 }
    );
    if (last % 100000 === 0 || last === count)
      console.log(JSON.stringify({ fixture: 'synthetic-history', rows: last }));
  }
  for (const table of ['Incident', 'Alert', 'IncidentFingerprint'] as const)
    await prisma.$executeRaw(Prisma.sql`VACUUM (ANALYZE) ${Prisma.raw(`"${table}"`)}`);
  return prisma.incident.count({ where: { id: { startsWith: INTELLIGENCE_HISTORY_PREFIX } } });
}
