/**
 * Query-plan gate for the intelligence engine: EXPLAIN evidence that every hot query the lane runs is
 * index-backed on a seeded benchmark database, asserted rather than merely recorded.
 *
 * The claim statement is the production one (imported from the work queue, including the `aged` arm), so
 * the plan recorded here is the plan the lane runs. Read queries use EXPLAIN ANALYZE; the claim is an
 * UPDATE, so it is explained without execution.
 *
 * Usage (after intelligence-storm.ts or intelligence-foundation.ts has seeded the database):
 *   DATABASE_URL=postgresql://.../opsknight_bench \
 *   npx ts-node -r tsconfig-paths/register --project tsconfig.script.json \
 *     tests/load/intelligence-query-plans.ts [--output path.json] [--no-gate]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Prisma } from '@prisma/client';
import prisma from '../../src/lib/prisma';
import {
  fullTextQueryText,
  planFullTextQuery,
  termFrequencies,
} from '../../src/lib/intelligence/similarity/term-stats';
import { claimWorkItemsSql } from '../../src/lib/intelligence/jobs/work-queue';
import { INTELLIGENCE_ENGINE_VERSION } from '../../src/lib/intelligence/contract';

/** Any one of the listed indexes satisfies the query; alternatives cover optional extensions. */
const EXPECTED_INDEXES: Record<string, string[]> = {
  sameService: ['idx_incident_fingerprint_service_recent'],
  fullText: ['idx_incident_fingerprint_search', 'idx_incident_fingerprint_fts'],
  trigram: ['idx_incident_fingerprint_trgm_gist', 'idx_incident_fingerprint_trgm'],
  claim: [
    'idx_intelligence_work_item_unleased',
    'idx_intelligence_work_item_ready',
    'IntelligenceWorkItem_leaseUntil_idx',
  ],
  changeWindow: ['idx_change_event_service_recent', 'idx_change_event_retention'],
  pagingCheck: ['idx_background_job_intelligence_paging'],
  reconcileWatermark: ['idx_incident_updated_at'],
  embedPage: ['idx_incident_fingerprint_retention', 'idx_incident_fingerprint_service_recent'],
  runbookHistory: ['idx_runbook_execution_service_recent'],
};

/**
 * Range queries whose selectivity depends on history size: on a small table the planner rightly prefers a
 * sequential scan, so these are judged only once their table holds at least this many rows.
 */
const MIN_ROWS_TO_JUDGE: Record<
  string,
  { table: 'Incident' | 'IncidentFingerprint' | 'IntelligenceWorkItem'; rows: number }
> = {
  reconcileWatermark: { table: 'Incident', rows: 200_000 },
  embedPage: { table: 'IncidentFingerprint', rows: 200_000 },
  // A drained queue is tiny and rightly scanned; the claim plan matters while a backlog exists.
  claim: { table: 'IntelligenceWorkItem', rows: 10_000 },
};

function indexNames(plan: unknown): string[] {
  if (!plan || typeof plan !== 'object') return [];
  return Object.entries(plan).flatMap(([key, child]) =>
    key === 'Index Name' && typeof child === 'string' ? [child] : indexNames(child)
  );
}

function argValue(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

async function explain(query: Prisma.Sql, analyze: boolean): Promise<unknown> {
  return prisma.$transaction(
    async tx => {
      await tx.$executeRaw`SET LOCAL statement_timeout = '30s'`;
      const rows = await tx.$queryRaw<Array<{ 'QUERY PLAN': unknown }>>(
        analyze
          ? Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`
          : Prisma.sql`EXPLAIN (FORMAT JSON) ${query}`
      );
      return rows[0]['QUERY PLAN'];
    },
    { timeout: 35000 }
  );
}

async function main() {
  if (!/_(test|bench)$/.test(new URL(process.env.DATABASE_URL ?? '').pathname)) {
    throw new Error('Dedicated test/benchmark database required');
  }
  const gate = !process.argv.includes('--no-gate');
  const output =
    argValue('output') ??
    `artifacts/load-certification/intelligence/query-plans-${Date.now()}.json`;

  const source =
    (await prisma.incidentFingerprint.findFirst({
      where: { incidentId: { startsWith: 'hist-' }, template: { not: '' } },
      select: { incidentId: true, serviceId: true, template: true, tokens: true },
    })) ??
    (await prisma.incidentFingerprint.findFirstOrThrow({
      where: { template: { not: '' } },
      select: { incidentId: true, serviceId: true, template: true, tokens: true },
    }));
  const lowerBound = new Date(Date.now() - 180 * 86400000);
  const ftsQuery = fullTextQueryText(planFullTextQuery(source.tokens, await termFrequencies()));
  // A steady-state repair cursor sits just behind the newest change, not at the start of history.
  const [{ latest }] = await prisma.$queryRaw<Array<{ latest: Date | null }>>`
    SELECT max("updatedAt") AS latest FROM "Incident"`;
  const cursorAt = new Date((latest ?? new Date()).getTime() - 60_000);

  const queries: Record<string, { sql: Prisma.Sql; analyze: boolean }> = {
    sameService: {
      analyze: true,
      sql: Prisma.sql`SELECT "incidentId" FROM "IncidentFingerprint"
      WHERE "serviceId" = ${source.serviceId} AND "incidentCreatedAt" > ${lowerBound}
      ORDER BY "incidentCreatedAt" DESC LIMIT 50`,
    },
    fullText: {
      analyze: true,
      sql: Prisma.sql`SELECT "incidentId" FROM "IncidentFingerprint"
      WHERE "searchVector" @@ websearch_to_tsquery('simple', ${ftsQuery})
        AND "incidentCreatedAt" > ${lowerBound}
      ORDER BY ts_rank("searchVector", websearch_to_tsquery('simple', ${ftsQuery})) DESC LIMIT 50`,
    },
    trigram: {
      analyze: true,
      sql: Prisma.sql`SELECT "incidentId" FROM "IncidentFingerprint"
      WHERE template % ${source.template} AND "incidentCreatedAt" > ${lowerBound}
      ORDER BY template <-> ${source.template} LIMIT 50`,
    },
    // The production statement, including the aged arm and the kind exclusion; explained, not executed.
    claim: { analyze: false, sql: claimWorkItemsSql({ limit: 50, excludeKinds: ['SEND_DIGEST'] }) },
    changeWindow: {
      analyze: true,
      sql: Prisma.sql`SELECT id FROM "ChangeEvent"
      WHERE "serviceId" = ${source.serviceId} AND "occurredAt" >= now() - interval '6 hours'
        AND "occurredAt" <= now()`,
    },
    // AUTO correlation waits behind the initial paging outbox; this lookup must never scan BackgroundJob.
    pagingCheck: {
      analyze: true,
      sql: Prisma.sql`SELECT min("scheduledAt") AS next FROM "BackgroundJob"
        WHERE "status" IN ('PENDING', 'PROCESSING', 'PENDING_V2', 'PROCESSING_V2')
          AND "payload"->>'incidentId' = ${source.incidentId}
          AND (("type" = 'ESCALATION' AND "scheduledAt" <= now())
            OR ("type" = 'SCHEDULED_TASK' AND "payload"->>'effect' = 'TRIGGER_ESCALATION_NOTIFICATIONS'))`,
    },
    // Lost-signal repair walks incidents by updatedAt from a watermark every cycle.
    reconcileWatermark: {
      analyze: true,
      sql: Prisma.sql`SELECT "id", "updatedAt" FROM "Incident"
      WHERE "updatedAt" >= ${cursorAt} AND "updatedAt" <= now()
        AND ("updatedAt" > ${cursorAt} OR "id" > '')
      ORDER BY "updatedAt" ASC, "id" ASC LIMIT 500`,
    },
    // Semantic backfill walks the lookback window newest first in bounded pages.
    embedPage: {
      analyze: true,
      sql: Prisma.sql`SELECT f."incidentId", f."incidentCreatedAt" FROM "IncidentFingerprint" f
      WHERE f."incidentCreatedAt" > ${lowerBound} AND length(f."template") > 0 AND f."templateHash" IS NOT NULL
      ORDER BY f."incidentCreatedAt" DESC, f."incidentId" DESC LIMIT 5000`,
    },
    // Runbook outcome ranking aggregates a service's recent executions.
    runbookHistory: {
      analyze: true,
      sql: Prisma.sql`SELECT e."runbookId", count(*)::int FROM "RunbookExecution" e
      WHERE e."serviceId" = ${source.serviceId} AND e."createdAt" >= ${lowerBound}
        AND e."status" IN ('SUCCEEDED', 'FAILED', 'TIMED_OUT')
      GROUP BY e."runbookId"`,
    },
  };

  const [{ incidents, fingerprints, workItems }] = await prisma.$queryRaw<
    Array<{ incidents: bigint; fingerprints: bigint; workItems: bigint }>
  >`SELECT (SELECT count(*) FROM "Incident") AS incidents,
           (SELECT count(*) FROM "IncidentFingerprint") AS fingerprints,
           (SELECT count(*) FROM "IntelligenceWorkItem") AS "workItems"`;
  const tableRows = {
    Incident: Number(incidents),
    IncidentFingerprint: Number(fingerprints),
    IntelligenceWorkItem: Number(workItems),
  };
  const plans: Record<string, unknown> = {};
  const indexesUsed: Record<string, string[]> = {};
  const missing: string[] = [];
  const notJudged: string[] = [];
  for (const [name, { sql, analyze }] of Object.entries(queries)) {
    try {
      plans[name] = await explain(sql, analyze);
    } catch (error) {
      // Optional extensions (pg_trgm) may be absent: record it, and judge only the queries that ran.
      plans[name] = { error: error instanceof Error ? error.message : String(error) };
      if (name !== 'trigram') missing.push(`${name} (query failed)`);
      continue;
    }
    indexesUsed[name] = indexNames(plans[name]);
    const threshold = MIN_ROWS_TO_JUDGE[name];
    if (threshold && tableRows[threshold.table] < threshold.rows) {
      notJudged.push(`${name} (${threshold.table} has ${tableRows[threshold.table]} rows)`);
      continue;
    }
    const expected = EXPECTED_INDEXES[name] ?? [];
    if (expected.length && !expected.some(index => indexesUsed[name].includes(index)))
      missing.push(`${name} (used ${indexesUsed[name].join(', ') || 'no index'})`);
  }

  const report = {
    measuredAt: new Date().toISOString(),
    engineVersion: INTELLIGENCE_ENGINE_VERSION,
    node: process.version,
    tableRows,

    expectedIndexes: EXPECTED_INDEXES,
    minRowsToJudge: MIN_ROWS_TO_JUDGE,
    indexesUsed,
    missing,
    notJudged,
    passed: missing.length === 0,
    plans,
    note: 'Read queries use EXPLAIN ANALYZE on synthetic history; the claim UPDATE is explained without execution. Plans depend on data and host load.',
  };
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify({ passed: report.passed, missing, notJudged, indexesUsed, report: output })
  );
  if (gate && !report.passed) process.exitCode = 1;
}
main()
  .then(() => prisma.$disconnect())
  .catch(async error => {
    console.error(error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
