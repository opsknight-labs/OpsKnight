import 'server-only';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { logger } from '@/lib/logger';
import { deterministicOnly } from '../ai/call-site';
import { incidentReadableSql } from './readable-sql';
import { incidentRef, noiseBadgeKind, noiseBadgeLabel } from './explain';

/**
 * Intelligence badges for one page of the incident list, from ONE bounded, index-backed query:
 *
 * - grouped:     the incident is a child under an accepted PARENT_CHILD link (parent shown only if readable)
 * - parent:      the incident is a storm/correlation parent with N grouped incidents or alerts
 * - suppressed / maintenance: an applied, unreversed pre-paging decision on the incident
 * - similar:     a fresh, high-confidence similar-incident finding whose precedent the viewer may read
 *
 * Every branch is keyed by the page's incident ids (at most MAX_IDS) and uses an existing index
 * (IncidentRelationship source/target, PrePagingDecision.incidentId, IntelligenceFinding lookup).
 */

export type IncidentListBadge =
  | { kind: 'grouped'; parentId: string | null; parentRef: string | null }
  | { kind: 'parent'; count: number }
  | { kind: 'suppressed' | 'maintenance'; label: string }
  | { kind: 'similar'; incidentId: string; ref: string; confidencePercent: number };

export type IncidentListBadges = Record<string, IncidentListBadge[]>;

export const LIST_BADGE_LIMITS = {
  maxIds: 100,
  /** A similar-incident finding older than this is not "fresh" enough to badge. */
  similarFreshHours: 72,
  /** Minimum finding confidence for the "similar to" badge. */
  similarMinConfidence: 0.8,
} as const;

type Row = {
  kind: 'GROUPED' | 'PARENT' | 'NOISE' | 'SIMILAR';
  incidentId: string;
  refId: string | null;
  control: string | null;
  label: string | null;
  num: number | null;
};

const GROUP_ACTIONS = Prisma.sql`ARRAY['GROUP_CHILD']::"PrePagingAction"[]`;
const NOISE_CONTROLS = Prisma.sql`ARRAY['MAINTENANCE','SUPPRESSION','FLAPPING','ORCHESTRATION']::"PrePagingControl"[]`;
const NOISE_ACTIONS = Prisma.sql`ARRAY['SUPPRESS','DROP','DOWNGRADE','HOLD']::"PrePagingAction"[]`;

/** List badges are deterministic: the gateway refuses any model call made while they load. */
export const getIncidentListBadges: typeof loadIncidentListBadges = (...args) =>
  deterministicOnly('incident list badges', () => loadIncidentListBadges(...args));

async function loadIncidentListBadges(
  incidentIds: readonly string[],
  actor: AuthorizationActor,
  options: { now?: Date } = {},
  client: typeof prisma = prisma
): Promise<IncidentListBadges> {
  const ids = [...new Set(incidentIds)].slice(0, LIST_BADGE_LIMITS.maxIds);
  if (!ids.length) return {};
  if (!hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_SUGGESTIONS_READ)) return {};
  let parentReadable: Prisma.Sql;
  let similarReadable: Prisma.Sql;
  let pageReadable: Prisma.Sql;
  try {
    parentReadable = incidentReadableSql('p', actor);
    similarReadable = incidentReadableSql('s', actor);
    pageReadable = incidentReadableSql('i', actor);
  } catch {
    return {};
  }
  const now = options.now ?? new Date();
  const freshSince = new Date(now.getTime() - LIST_BADGE_LIMITS.similarFreshHours * 3_600_000);
  const idArray = Prisma.sql`ARRAY[${Prisma.join(ids)}]::text[]`;

  let rows: Row[];
  try {
    rows = await client.$queryRaw<Row[]>(Prisma.sql`
      WITH page AS (
        SELECT i."id" FROM "Incident" i WHERE i."id" = ANY(${idArray}) AND ${pageReadable}
      )
      SELECT * FROM (
        SELECT DISTINCT ON (r."sourceIncidentId")
          'GROUPED' AS kind, r."sourceIncidentId" AS "incidentId",
          CASE WHEN ${parentReadable} THEN p."id" ELSE NULL END AS "refId",
          NULL::text AS control, NULL::text AS label, NULL::double precision AS num
        FROM "IncidentRelationship" r
        JOIN "Incident" p ON p."id" = r."targetIncidentId"
        WHERE r."sourceIncidentId" IN (SELECT "id" FROM page)
          AND r."type" = 'PARENT_CHILD' AND r."decision" = 'ACCEPTED'
        ORDER BY r."sourceIncidentId", r."updatedAt" DESC
      ) grouped_rows
      UNION ALL
      SELECT 'PARENT', member_rows."incidentId", NULL, NULL, NULL, SUM(member_rows.n)::double precision
      FROM (
        SELECT r."targetIncidentId" AS "incidentId", COUNT(*) AS n
        FROM "IncidentRelationship" r
        WHERE r."targetIncidentId" IN (SELECT "id" FROM page)
          AND r."type" = 'PARENT_CHILD' AND r."decision" = 'ACCEPTED'
        GROUP BY r."targetIncidentId"
        UNION ALL
        SELECT d."incidentId", COUNT(*)
        FROM "PrePagingDecision" d
        WHERE d."incidentId" IN (SELECT "id" FROM page)
          AND d."applied" = true AND d."reversedAt" IS NULL AND d."action" = ANY(${GROUP_ACTIONS})
        GROUP BY d."incidentId"
      ) member_rows
      GROUP BY member_rows."incidentId"
      UNION ALL
      SELECT * FROM (
        SELECT DISTINCT ON (d."incidentId", d."control")
          'NOISE', d."incidentId", NULL, d."control"::text, d."sourceName", NULL::double precision
        FROM "PrePagingDecision" d
        WHERE d."incidentId" IN (SELECT "id" FROM page)
          AND d."applied" = true AND d."reversedAt" IS NULL
          AND d."control" = ANY(${NOISE_CONTROLS}) AND d."action" = ANY(${NOISE_ACTIONS})
        ORDER BY d."incidentId", d."control", d."createdAt" DESC
      ) noise_rows
      UNION ALL
      SELECT * FROM (
        SELECT DISTINCT ON (f."incidentId")
          'SIMILAR', f."incidentId", s."id", NULL, NULL, f."confidence"
        FROM "IntelligenceFinding" f
        JOIN "Incident" s ON s."id" = f."subjectRef"
        WHERE f."incidentId" IN (SELECT "id" FROM page)
          AND f."status" = 'ACTIVE' AND f."kind" = 'SIMILAR_INCIDENT'
          AND f."confidence" >= ${LIST_BADGE_LIMITS.similarMinConfidence}
          AND f."createdAt" >= ${freshSince}
          AND ${similarReadable}
        ORDER BY f."incidentId", f."rank" ASC, f."confidence" DESC
      ) similar_rows`);
  } catch (error) {
    // Badges are decoration: a missing table (feature not migrated) or a slow query never breaks the list.
    logger.warn('[Intelligence] Incident list badges unavailable', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }

  const badges = new Map<string, IncidentListBadge[]>();
  const push = (id: string, badge: IncidentListBadge) => {
    const list = badges.get(id);
    if (list) list.push(badge);
    else badges.set(id, [badge]);
  };
  for (const row of rows) {
    switch (row.kind) {
      case 'GROUPED':
        push(row.incidentId, {
          kind: 'grouped',
          parentId: row.refId,
          parentRef: row.refId ? incidentRef(row.refId) : null,
        });
        break;
      case 'PARENT':
        if (row.num && row.num > 0)
          push(row.incidentId, { kind: 'parent', count: Number(row.num) });
        break;
      case 'NOISE': {
        const kind = row.control ? noiseBadgeKind(row.control) : null;
        if (kind && row.control)
          push(row.incidentId, { kind, label: noiseBadgeLabel(row.control, row.label) });
        break;
      }
      case 'SIMILAR':
        if (row.refId)
          push(row.incidentId, {
            kind: 'similar',
            incidentId: row.refId,
            ref: incidentRef(row.refId),
            confidencePercent: Math.round(Number(row.num ?? 0) * 100),
          });
        break;
    }
  }
  return Object.fromEntries(badges);
}

/** Values accepted by the incident list's noise-decision filter (`?noise=`). */
export const NOISE_FILTERS = ['grouped', 'suppressed', 'maintenance'] as const;
export type NoiseFilter = (typeof NOISE_FILTERS)[number];

export function normalizeNoiseFilter(value: string | undefined | null): NoiseFilter | null {
  return (NOISE_FILTERS as readonly string[]).includes(value ?? '') ? (value as NoiseFilter) : null;
}

/**
 * Prisma condition for the noise filter, combined with the list's own (already scoped) where clause.
 * Relation filters on indexed foreign keys; never applied when the viewer may not read intelligence.
 */
export function noiseFilterWhere(filter: NoiseFilter): Prisma.IncidentWhereInput {
  const live = { applied: true, reversedAt: null } as const;
  switch (filter) {
    case 'grouped':
      return {
        OR: [
          { relationshipsAsSource: { some: { type: 'PARENT_CHILD', decision: 'ACCEPTED' } } },
          { relationshipsAsTarget: { some: { type: 'PARENT_CHILD', decision: 'ACCEPTED' } } },
          { prePagingDecisions: { some: { ...live, action: 'GROUP_CHILD' } } },
        ],
      };
    case 'suppressed':
      return {
        prePagingDecisions: {
          some: {
            ...live,
            control: { in: ['SUPPRESSION', 'FLAPPING', 'ORCHESTRATION'] },
            action: { in: ['SUPPRESS', 'DROP', 'DOWNGRADE', 'HOLD'] },
          },
        },
      };
    case 'maintenance':
      return {
        prePagingDecisions: {
          some: {
            ...live,
            control: 'MAINTENANCE',
            action: { in: ['SUPPRESS', 'DROP', 'DOWNGRADE', 'HOLD'] },
          },
        },
      };
  }
}
