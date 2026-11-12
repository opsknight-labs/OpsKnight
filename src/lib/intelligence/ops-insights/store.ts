import 'server-only';
/* eslint-disable security/detect-object-injection -- Scope types are a closed union mapped to fixed table names. */
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { OPS_ROLLUPS } from '@/lib/metric-rollup';
import { stableAnalysisHash } from '../jobs/input-hash';
import {
  OPS_INSIGHT_LIMITS,
  opsInsightItemSchema,
  severityRank,
  type OpsInsightArea,
  type OpsInsightItem,
  type OpsInsightScope,
} from './contract';

type Client = Prisma.TransactionClient | typeof prisma;

export interface UpsertInsightsOptions {
  area: OpsInsightArea;
  /** The work item's generation: a slower, older analysis can never overwrite a newer one. Unfenced when omitted. */
  generation?: number;
  client?: Client;
}

export interface UpsertInsightsResult {
  written: number;
  resolved: number;
  /** Items dropped because they failed the contract (logged by the caller) or exceeded the per-kind cap. */
  rejected: number;
}

/**
 * Replaces what one producer says about one scope, in two statements.
 *
 * - Each item is written on the unique (scopeType, scopeId, kind, key), so recomputation updates a row
 *   instead of adding one. A person's decision is kept: an ACCEPTED or DISMISSED insight stays that way
 *   while it is still produced. A RESOLVED insight that comes back is OPEN again.
 * - Open or accepted insights of this kind that were not produced this time are RESOLVED.
 *
 * Idempotent, and fenced on `generation` when one is given.
 */
export async function upsertInsights(
  scope: OpsInsightScope,
  kind: string,
  items: readonly OpsInsightItem[],
  options: UpsertInsightsOptions
): Promise<UpsertInsightsResult> {
  const client = options.client ?? prisma;
  const generation = options.generation ?? 0;
  const fence =
    options.generation === undefined
      ? Prisma.sql`TRUE`
      : Prisma.sql`"OpsInsight"."generation" <= ${generation}`;

  const valid = new Map<string, ReturnType<typeof opsInsightItemSchema.parse>>();
  let rejected = 0;
  for (const item of items) {
    const parsed = opsInsightItemSchema.safeParse(item);
    // One row per key: ON CONFLICT cannot touch the same row twice in a single statement.
    if (!parsed.success || valid.has(parsed.data.key)) rejected += 1;
    else valid.set(parsed.data.key, parsed.data);
  }
  const kept = [...valid.values()]
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
    .slice(0, OPS_INSIGHT_LIMITS.itemsPerKind);
  rejected += valid.size - kept.length;

  let written = 0;
  if (kept.length > 0) {
    const rows = kept.map(
      item => Prisma.sql`(
        gen_random_uuid()::text, ${scope.type}::"OpsInsightScopeType", ${scope.id}, ${kind}, ${item.key},
        ${options.area}, ${item.severity}::"OpsInsightSeverity", ${item.title}, ${item.summary},
        ${JSON.stringify(item.evidence)}::jsonb, ${item.draftHref ?? null},
        ${stableAnalysisHash(item)}, ${generation}, now())`
    );
    const reopened = Prisma.sql`"OpsInsight"."status" = 'RESOLVED'`;
    written = await client.$executeRaw(Prisma.sql`
      INSERT INTO "OpsInsight" ("id", "scopeType", "scopeId", "kind", "key", "area", "severity", "title",
        "summary", "evidence", "draftHref", "inputHash", "generation", "updatedAt")
      VALUES ${Prisma.join(rows)}
      ON CONFLICT ("scopeType", "scopeId", "kind", "key") DO UPDATE SET
        "area" = EXCLUDED."area",
        "severity" = EXCLUDED."severity",
        "title" = EXCLUDED."title",
        "summary" = EXCLUDED."summary",
        "evidence" = EXCLUDED."evidence",
        "draftHref" = EXCLUDED."draftHref",
        "inputHash" = EXCLUDED."inputHash",
        "generation" = GREATEST("OpsInsight"."generation", EXCLUDED."generation"),
        "lastSeenAt" = now(),
        "updatedAt" = now(),
        "firstSeenAt" = CASE WHEN ${reopened} THEN now() ELSE "OpsInsight"."firstSeenAt" END,
        "decidedById" = CASE WHEN ${reopened} THEN NULL ELSE "OpsInsight"."decidedById" END,
        "decidedAt" = CASE WHEN ${reopened} THEN NULL ELSE "OpsInsight"."decidedAt" END,
        "resolvedAt" = NULL,
        "status" = CASE WHEN ${reopened} THEN 'OPEN'::"OpsInsightStatus" ELSE "OpsInsight"."status" END
      WHERE ${fence}`);
  }

  const resolved = await client.$executeRaw(Prisma.sql`
    UPDATE "OpsInsight" SET "status" = 'RESOLVED', "resolvedAt" = now(), "updatedAt" = now()
    WHERE "scopeType" = ${scope.type}::"OpsInsightScopeType" AND "scopeId" = ${scope.id} AND "kind" = ${kind}
      AND "status" IN ('OPEN', 'ACCEPTED')
      AND ${fence}
      AND NOT ("key" = ANY(${kept.map(item => item.key)}::text[]))`);

  return { written, resolved, rejected };
}

/** Resolves everything open on a scope for kinds that no longer apply (area off, producer removed). */
export async function resolveInsightsExcept(
  scope: OpsInsightScope,
  activeKinds: readonly string[],
  client: Client = prisma
): Promise<number> {
  return client.$executeRaw(Prisma.sql`
    UPDATE "OpsInsight" SET "status" = 'RESOLVED', "resolvedAt" = now(), "updatedAt" = now()
    WHERE "scopeType" = ${scope.type}::"OpsInsightScopeType" AND "scopeId" = ${scope.id}
      AND "status" IN ('OPEN', 'ACCEPTED')
      AND NOT ("kind" = ANY(${[...activeKinds]}::text[]))`);
}

const SCOPE_TABLES = {
  SERVICE: 'Service',
  POLICY: 'EscalationPolicy',
  SCHEDULE: 'OnCallSchedule',
  RUNBOOK: 'Runbook',
  USER: 'User',
  TEAM: 'Team',
} as const;

/** The table each scope type points at. Fixed identifiers, never user input. */
export function scopeTable(type: OpsInsightScope['type']): Prisma.Sql {
  return Prisma.raw(`"${SCOPE_TABLES[type]}"`);
}

/**
 * Retention, one bounded batch: decided or resolved insights older than the cutoff, and insights and
 * computation state whose scope row is gone (a deleted user's insights go with the user).
 */
export async function purgeOpsInsights(
  client: Client,
  options: { cutoff: Date; limit: number }
): Promise<number> {
  let deleted = await client.$executeRaw(Prisma.sql`
    DELETE FROM "OpsInsight" WHERE "id" IN (
      SELECT "id" FROM "OpsInsight"
      WHERE "status" IN ('RESOLVED', 'DISMISSED') AND "updatedAt" < ${options.cutoff}
      ORDER BY "updatedAt" LIMIT ${options.limit})`);
  for (const type of Object.keys(SCOPE_TABLES) as Array<OpsInsightScope['type']>) {
    const gone = Prisma.sql`NOT EXISTS (SELECT 1 FROM ${scopeTable(type)} scope WHERE scope."id" = orphan."scopeId")`;
    deleted += await client.$executeRaw(Prisma.sql`
      DELETE FROM "OpsInsight" WHERE "id" IN (
        SELECT orphan."id" FROM "OpsInsight" orphan
        WHERE orphan."scopeType" = ${type}::"OpsInsightScopeType" AND ${gone} LIMIT ${options.limit})`);
    await client.$executeRaw(Prisma.sql`
      DELETE FROM "OpsInsightScopeState" WHERE ("scopeType", "scopeId") IN (
        SELECT orphan."scopeType", orphan."scopeId" FROM "OpsInsightScopeState" orphan
        WHERE orphan."scopeType" = ${type}::"OpsInsightScopeType" AND ${gone} LIMIT ${options.limit})`);
  }
  // Page counts per person are personal data: they go with the person.
  deleted += await client.$executeRaw(Prisma.sql`
    DELETE FROM "MetricRollup" WHERE "id" IN (
      SELECT rollup."id" FROM "MetricRollup" rollup
      WHERE rollup."name" = ${OPS_ROLLUPS.pagesPerUserHour}
        AND NOT EXISTS (SELECT 1 FROM "User" person WHERE person."id" = rollup."subjectKey")
      LIMIT ${options.limit})`);
  return deleted;
}
