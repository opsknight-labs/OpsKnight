import 'server-only';
import { Prisma } from '@prisma/client';
import type { OpsInsightItem } from '../contract';
import type { OpsInsightProducer } from '../producer';

/**
 * Suggestion acceptance drift, scope SERVICE, area intelligence.
 *
 * Per finding kind on this service: the share of responder verdicts that were positive in the last 7 days
 * against the 28 days before. A drop of more than 20 points with at least 20 verdicts in each window means
 * the suggestions got worse (or the service changed under them). It says so; it changes nothing.
 *
 * Reads: one statement on idx (serviceId, createdAt) of IntelligenceFeedback, capped by the 35-day window.
 */
export const ACCEPTANCE_DRIFT_KIND = 'intelligence.acceptance-drift';
export const ACCEPTANCE_DRIFT_LIMITS = {
  currentDays: 7,
  baselineDays: 28,
  minVerdicts: 20,
  /** Percentage points. */
  minDrop: 20,
} as const;

export interface AcceptanceDriftInput {
  kinds: Array<{
    kind: string;
    currentTotal: number;
    currentAccepted: number;
    baselineTotal: number;
    baselineAccepted: number;
  }>;
}

const DAY_MS = 86_400_000;
const KIND_LABELS: Record<string, string> = {
  SIMILAR_INCIDENT: 'Similar incidents',
  CHANGE_CORRELATION: 'Suspect changes',
  PROBABLE_CAUSE: 'Probable causes',
  RUNBOOK_RECOMMENDATION: 'Runbook recommendations',
};
const percent = (part: number, whole: number) => Math.round((100 * part) / whole);

export function deriveAcceptanceDrift(input: AcceptanceDriftInput): OpsInsightItem[] {
  const { minVerdicts, minDrop, currentDays, baselineDays } = ACCEPTANCE_DRIFT_LIMITS;
  return input.kinds.flatMap(row => {
    if (row.currentTotal < minVerdicts || row.baselineTotal < minVerdicts) return [];
    const now = percent(row.currentAccepted, row.currentTotal);
    const before = percent(row.baselineAccepted, row.baselineTotal);
    if (before - now <= minDrop) return [];
    const label = KIND_LABELS[row.kind] ?? row.kind.toLowerCase().replace(/_/g, ' ');
    return [
      {
        key: row.kind,
        severity: 'WARNING' as const,
        title: `${label}: acceptance fell from ${before}% to ${now}%`,
        summary: `Responders accepted ${now}% of ${row.currentTotal} ${label.toLowerCase()} on this service in the last ${currentDays} days, against ${before}% of ${row.baselineTotal} in the ${baselineDays} days before. Review recent changes to the service or its intelligence policy.`,
        evidence: {
          window: `last ${currentDays} days vs previous ${baselineDays} days`,
          facts: [
            { label: 'Accepted, last week', value: `${now}% of ${row.currentTotal}` },
            { label: 'Accepted, before', value: `${before}% of ${row.baselineTotal}` },
            { label: 'Drop', value: `${before - now} points` },
          ],
        },
      },
    ];
  });
}

export const acceptanceDriftProducer: OpsInsightProducer<AcceptanceDriftInput> = {
  kind: ACCEPTANCE_DRIFT_KIND,
  version: 1,
  area: 'intelligence',
  scopeType: 'SERVICE',

  async loadInput(scope, { tx, now }) {
    const { currentDays, baselineDays } = ACCEPTANCE_DRIFT_LIMITS;
    const split = new Date(now.getTime() - currentDays * DAY_MS);
    const since = new Date(split.getTime() - baselineDays * DAY_MS);
    const kinds = await tx.$queryRaw<AcceptanceDriftInput['kinds']>(Prisma.sql`
      SELECT f."kind",
        count(*) FILTER (WHERE fb."createdAt" >= ${split})::int AS "currentTotal",
        count(*) FILTER (WHERE fb."createdAt" >= ${split} AND fb."verdict" IN ('HELPFUL', 'CORRECT'))::int AS "currentAccepted",
        count(*) FILTER (WHERE fb."createdAt" < ${split})::int AS "baselineTotal",
        count(*) FILTER (WHERE fb."createdAt" < ${split} AND fb."verdict" IN ('HELPFUL', 'CORRECT'))::int AS "baselineAccepted"
      FROM "IntelligenceFeedback" fb JOIN "IntelligenceFinding" f ON f."id" = fb."subjectId"
      WHERE fb."serviceId" = ${scope.id} AND fb."subjectType" = 'FINDING'
        AND fb."createdAt" >= ${since} AND fb."createdAt" < ${now}
        AND fb."verdict" IN ('HELPFUL', 'NOT_HELPFUL', 'CORRECT', 'INCORRECT')
      GROUP BY f."kind" ORDER BY f."kind"`);
    return kinds.length ? { kinds } : null;
  },

  derive: deriveAcceptanceDrift,
};
