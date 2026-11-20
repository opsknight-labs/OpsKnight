import 'server-only';
import { Prisma } from '@prisma/client';
import type { OpsInsightItem } from '../contract';
import type { OpsInsightProducer } from '../producer';

/**
 * Metric early warning, scope SERVICE, area intelligence.
 *
 * The scheduled EVALUATE_METRIC_TEMPLATE lane job compares each enabled metric template with its seasonal
 * baseline and records deviations as MetricAnomaly rows. This producer turns a recent deviation that no
 * incident on the service has caught yet into an insight. It never pages and never opens an incident.
 *
 * Reads: one statement on MetricAnomaly (serviceId, at) and Incident (serviceId, createdAt), capped.
 */
export const METRIC_EARLY_WARNING_KIND = 'intelligence.metric-early-warning';
export const METRIC_EARLY_WARNING_LIMITS = { windowHours: 24, templates: 10 } as const;

export interface MetricEarlyWarningInput {
  deviations: Array<{
    templateId: string;
    name: string;
    direction: string;
    /** Peak deviation in robust standard units, one decimal. */
    score: number;
    startedAt: string;
    series: number;
  }>;
}

export function deriveMetricEarlyWarnings(input: MetricEarlyWarningInput): OpsInsightItem[] {
  return input.deviations.map(row => {
    const way = row.direction === 'DOWN' ? 'below' : 'above';
    return {
      key: row.templateId,
      severity: row.score >= 10 ? ('WARNING' as const) : ('INFO' as const),
      title: `Early warning: ${row.name} is ${way} its usual range`.slice(0, 140),
      summary: `${row.name} moved ${row.score} deviations ${way} its seasonal baseline from ${row.startedAt} UTC, and no incident on this service has opened since. This is an early warning only: nobody was paged.`,
      evidence: {
        window: `last ${METRIC_EARLY_WARNING_LIMITS.windowHours} hours`,
        facts: [
          { label: 'Metric template', value: row.name.slice(0, 160) },
          { label: 'Direction', value: way },
          { label: 'Peak deviation (robust units)', value: String(row.score) },
          { label: 'Started', value: `${row.startedAt} UTC` },
          { label: 'Series affected', value: String(row.series) },
        ],
      },
    };
  });
}

export const metricEarlyWarningProducer: OpsInsightProducer<MetricEarlyWarningInput> = {
  kind: METRIC_EARLY_WARNING_KIND,
  version: 1,
  area: 'intelligence',
  scopeType: 'SERVICE',

  async loadInput(scope, { tx, now }) {
    const since = new Date(now.getTime() - METRIC_EARLY_WARNING_LIMITS.windowHours * 3_600_000);
    const rows = await tx.$queryRaw<
      Array<{
        templateId: string;
        name: string;
        direction: string;
        score: number;
        startedAt: Date;
        series: number;
      }>
    >(Prisma.sql`
      SELECT a."templateId", t."name", (array_agg(a."direction" ORDER BY a."score" DESC))[1] AS direction,
             max(a."score") AS score, min(a."at") AS "startedAt", count(DISTINCT a."seriesKey")::int AS series
      FROM "MetricAnomaly" a JOIN "ServiceMetricTemplate" t ON t."id" = a."templateId"
      WHERE a."serviceId" = ${scope.id} AND a."endAt" >= ${since} AND a."at" <= ${now}
        AND NOT EXISTS (
          SELECT 1 FROM "Incident" i WHERE i."serviceId" = a."serviceId" AND i."createdAt" >= a."at")
      GROUP BY a."templateId", t."name"
      ORDER BY max(a."score") DESC, a."templateId"
      LIMIT ${METRIC_EARLY_WARNING_LIMITS.templates}`);
    if (rows.length === 0) return null;
    return {
      deviations: rows.map(row => ({
        templateId: row.templateId,
        name: row.name,
        direction: row.direction,
        score: Math.round(row.score * 10) / 10,
        startedAt: row.startedAt.toISOString().slice(0, 16).replace('T', ' '),
        series: row.series,
      })),
    };
  },

  derive: deriveMetricEarlyWarnings,
};
