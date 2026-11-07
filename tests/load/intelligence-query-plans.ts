/** Read-only EXPLAIN ANALYZE evidence for the seeded intelligence benchmark database. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { Prisma } from '@prisma/client';
import prisma from '../../src/lib/prisma';
import {
  selectQueryTerms,
  termFrequencies,
} from '../../src/lib/intelligence/similarity/term-stats';
import { INTELLIGENCE_ENGINE_VERSION } from '../../src/lib/intelligence/contract';

async function main() {
  if (!/_(test|bench)$/.test(new URL(process.env.DATABASE_URL ?? '').pathname)) {
    throw new Error('Dedicated test/benchmark database required');
  }
  const source = await prisma.incidentFingerprint.findFirstOrThrow({
    where: { incidentId: { startsWith: 'hist-' } },
    select: { incidentId: true, serviceId: true, template: true, tokens: true },
  });
  const lowerBound = new Date(Date.now() - 180 * 86400000);
  const ftsQuery = selectQueryTerms(source.tokens, await termFrequencies())
    .slice(0, 2)
    .join(' ');
  const queries: Record<string, Prisma.Sql> = {
    sameService: Prisma.sql`SELECT "incidentId" FROM "IncidentFingerprint"
      WHERE "serviceId" = ${source.serviceId} AND "incidentCreatedAt" > ${lowerBound}
      ORDER BY "incidentCreatedAt" DESC LIMIT 50`,
    fullText: Prisma.sql`SELECT "incidentId" FROM "IncidentFingerprint"
      WHERE "searchVector" @@ websearch_to_tsquery('simple', ${ftsQuery})
        AND "incidentCreatedAt" > ${lowerBound}
      ORDER BY ts_rank("searchVector", websearch_to_tsquery('simple', ${ftsQuery})) DESC LIMIT 50`,
    trigram: Prisma.sql`SELECT "incidentId" FROM "IncidentFingerprint"
      WHERE template % ${source.template} AND "incidentCreatedAt" > ${lowerBound}
      ORDER BY template <-> ${source.template} LIMIT 50`,
    claim: Prisma.sql`SELECT * FROM (
      (SELECT id, priority, "scheduledAt" FROM "IntelligenceWorkItem"
       WHERE "claimToken" IS NULL AND attempts < 8 AND "scheduledAt" <= now()
       ORDER BY priority, "scheduledAt" LIMIT 50)
      UNION ALL
      (SELECT id, priority, "scheduledAt" FROM "IntelligenceWorkItem"
       WHERE "claimToken" IS NOT NULL AND attempts < 8 AND "leaseUntil" < now()
       ORDER BY "leaseUntil" LIMIT 50)
    ) ready ORDER BY priority, "scheduledAt" LIMIT 50`,
    changeWindow: Prisma.sql`SELECT id FROM "ChangeEvent"
      WHERE "serviceId" = ${source.serviceId} AND "occurredAt" >= now() - interval '6 hours'
        AND "occurredAt" <= now()`,
  };
  const plans: Record<string, unknown> = {};
  for (const [name, query] of Object.entries(queries)) {
    plans[name] = await prisma.$transaction(
      async tx => {
        await tx.$executeRaw`SET LOCAL statement_timeout = '30s'`;
        const rows = await tx.$queryRaw<Array<{ 'QUERY PLAN': unknown }>>(
          Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`
        );
        return rows[0]['QUERY PLAN'];
      },
      { timeout: 35000 }
    );
  }
  const report = {
    measuredAt: new Date().toISOString(),
    engineVersion: INTELLIGENCE_ENGINE_VERSION,
    node: process.version,
    fingerprints: await prisma.incidentFingerprint.count(),
    plans,
    note: 'Read-only queries on synthetic history; plans and timings depend on data and host load.',
  };
  mkdirSync('artifacts/load-certification/intelligence', { recursive: true });
  const filename = `artifacts/load-certification/intelligence/query-plans-${Date.now()}.json`;
  writeFileSync(filename, JSON.stringify(report, null, 2));
  console.log(filename);
}
main()
  .then(() => prisma.$disconnect())
  .catch(async error => {
    console.error(error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
