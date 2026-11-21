import 'server-only';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { withDbBudget } from '../jobs/db-budget';
import {
  OVERVIEW_INCIDENT_SAMPLE_CAP,
  OVERVIEW_REVIEW_SAMPLE_CAP,
  OVERVIEW_SECTION_BUDGET,
  type OverviewScope,
} from './scope';
import type { OverviewWindow } from './window';

export interface AcceptanceRate {
  accepted: number;
  reviewed: number;
  /** accepted / reviewed, or null when nothing was reviewed (unknown, never a fabricated zero). */
  rate: number | null;
}

export interface OverviewSpeed {
  incidents: number;
  incidentsWithInsight: number;
  /** Seconds from incident creation to its first recorded finding. */
  firstInsightP50Seconds: number | null;
  firstInsightP90Seconds: number | null;
  /** Related-incident suggestions a responder accepted or rejected. */
  relatedSuggestions: AcceptanceRate;
  /** Similar, cause, change and runbook findings rated by responders. */
  findings: AcceptanceRate;
  /** Triage chips (urgency, owner, duplicate, time to resolve) accepted or dismissed. */
  triage: AcceptanceRate;
  sampleTruncated: boolean;
}

const rate = (accepted: number, reviewed: number): AcceptanceRate => ({
  accepted,
  reviewed,
  rate: reviewed > 0 ? accepted / reviewed : null,
});

/**
 * How quickly and how usefully Intelligence helped in the window, for incidents the viewer may read.
 * Every probe starts from an index-backed, capped candidate set: Incident(createdAt),
 * IncidentRelationship(updatedAt) and IntelligenceFeedback(createdAt), then joins by primary key or the
 * finding lookup index.
 */
export async function getOverviewSpeed(
  scope: OverviewScope,
  window: OverviewWindow,
  client: typeof prisma = prisma
): Promise<OverviewSpeed> {
  const { since, until } = window;
  return withDbBudget(
    OVERVIEW_SECTION_BUDGET,
    async tx => {
      const [insight] = await tx.$queryRaw<
        Array<{ sampled: bigint; covered: bigint; p50: number | null; p90: number | null }>
      >(Prisma.sql`
        WITH candidates AS MATERIALIZED (
          SELECT i.id, i."createdAt" FROM "Incident" i
          WHERE i."createdAt" >= ${since} AND i."createdAt" < ${until} ${scope.incidentSql('i')}
          ORDER BY i."createdAt" DESC LIMIT ${OVERVIEW_INCIDENT_SAMPLE_CAP + 1}
        ), inc AS (
          SELECT * FROM candidates ORDER BY "createdAt" DESC LIMIT ${OVERVIEW_INCIDENT_SAMPLE_CAP}
        ), firsts AS (
          SELECT GREATEST(0, EXTRACT(EPOCH FROM (f.first - inc."createdAt")))::float8 AS seconds
          FROM inc CROSS JOIN LATERAL (
            SELECT min(fi."createdAt") AS first FROM "IntelligenceFinding" fi WHERE fi."incidentId" = inc.id
          ) f
          WHERE f.first IS NOT NULL
        )
        SELECT (SELECT count(*) FROM candidates)::bigint AS sampled,
          count(*)::bigint AS covered,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY seconds)::float8 AS p50,
          percentile_cont(0.9) WITHIN GROUP (ORDER BY seconds)::float8 AS p90
        FROM firsts`);

      const [related] = await tx.$queryRaw<
        Array<{ accepted: bigint; reviewed: bigint; candidates: bigint }>
      >(Prisma.sql`
        WITH rel AS MATERIALIZED (
          SELECT r.id FROM "IncidentRelationship" r
          JOIN "Incident" i ON i.id = r."sourceIncidentId"
          WHERE r."updatedAt" >= ${since} ${scope.incidentSql('i')}
          ORDER BY r."updatedAt" DESC LIMIT ${OVERVIEW_REVIEW_SAMPLE_CAP + 1}
        )
        SELECT count(*) FILTER (WHERE e."toDecision" = 'ACCEPTED')::bigint AS accepted,
          count(*)::bigint AS reviewed,
          (SELECT count(*) FROM rel)::bigint AS candidates
        FROM rel JOIN "IncidentRelationshipEvent" e ON e."relationshipId" = rel.id
        WHERE e."actorType" = 'USER' AND e."fromDecision" = 'SUGGESTED'
          AND e."toDecision" IN ('ACCEPTED', 'REJECTED')
          AND e."createdAt" >= ${since} AND e."createdAt" < ${until}`);

      // Live verdicts of active users only, matching summarizeFeedback.
      const feedback = await tx.$queryRaw<
        Array<{ triage: boolean; positive: bigint; total: bigint; candidates: bigint }>
      >(Prisma.sql`
        WITH fb AS MATERIALIZED (
          SELECT fb.verdict, fb."subjectId" FROM "IntelligenceFeedback" fb
          JOIN "User" u ON u.id = fb."actorId" AND u.status = 'ACTIVE'
          WHERE fb."subjectType" = 'FINDING' AND fb."createdAt" >= ${since} AND fb."createdAt" < ${until}
          ORDER BY fb."createdAt" DESC LIMIT ${OVERVIEW_REVIEW_SAMPLE_CAP + 1}
        )
        SELECT (left(f.kind::text, 7) = 'TRIAGE_') AS triage,
          count(*) FILTER (WHERE fb.verdict IN ('HELPFUL', 'CORRECT'))::bigint AS positive,
          count(*)::bigint AS total,
          (SELECT count(*) FROM fb)::bigint AS candidates
        FROM fb
        JOIN "IntelligenceFinding" f ON f.id = fb."subjectId"
        JOIN "Incident" i ON i.id = f."incidentId"
        WHERE true ${scope.incidentSql('i')}
        GROUP BY 1`);

      const triageRow = feedback.find(row => row.triage);
      const findingRow = feedback.find(row => !row.triage);
      const feedbackCandidates = Number(feedback[0]?.candidates ?? 0);
      return {
        incidents: Math.min(Number(insight?.sampled ?? 0), OVERVIEW_INCIDENT_SAMPLE_CAP),
        incidentsWithInsight: Number(insight?.covered ?? 0),
        firstInsightP50Seconds: insight?.p50 ?? null,
        firstInsightP90Seconds: insight?.p90 ?? null,
        relatedSuggestions: rate(Number(related?.accepted ?? 0), Number(related?.reviewed ?? 0)),
        findings: rate(Number(findingRow?.positive ?? 0), Number(findingRow?.total ?? 0)),
        triage: rate(Number(triageRow?.positive ?? 0), Number(triageRow?.total ?? 0)),
        sampleTruncated:
          Number(insight?.sampled ?? 0) > OVERVIEW_INCIDENT_SAMPLE_CAP ||
          Number(related?.candidates ?? 0) > OVERVIEW_REVIEW_SAMPLE_CAP ||
          feedbackCandidates > OVERVIEW_REVIEW_SAMPLE_CAP,
      };
    },
    client
  );
}
