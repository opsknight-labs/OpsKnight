import { Prisma } from '@prisma/client';
import { run } from './queries';
import {
  metricAggregates,
  metricRowsCte,
  toAggregateMetrics,
  type AggregateMetrics,
  type AggregateRow,
} from './sql';
import type { AnalyticsScope } from './scope';
import type { AnalyticsWindow } from './window';

export type BreakdownDimension = 'team' | 'priority' | 'urgency';

export type BreakdownRow = AggregateMetrics & {
  /** Team id, priority or urgency; null for "No team" / "No priority". */
  key: string | null;
  label: string;
  previousIncidents: number;
};

const DIMENSIONS: Record<
  BreakdownDimension,
  { key: Prisma.Sql; label: Prisma.Sql; order: Prisma.Sql }
> = {
  // An incident's own team wins; otherwise it belongs to its service's team.
  team: {
    key: Prisma.sql`COALESCE(x."teamId", s."teamId")`,
    label: Prisma.sql`COALESCE(t.name, 'No team')`,
    order: Prisma.sql`incidents DESC, key IS NULL, label`,
  },
  priority: {
    key: Prisma.sql`x.priority`,
    label: Prisma.sql`COALESCE(x.priority, 'No priority')`,
    order: Prisma.sql`key IS NULL, key`,
  },
  urgency: {
    key: Prisma.sql`m.urgency::text`,
    label: Prisma.sql`initcap(m.urgency::text)`,
    order: Prisma.sql`array_position(ARRAY['HIGH', 'MEDIUM', 'LOW'], key)`,
  },
};

/**
 * Per-group metrics from the same metric rows as the KPIs, so the groups of
 * any dimension sum exactly to the KPI incident totals (current and previous).
 */
export async function queryBreakdown(
  scope: AnalyticsScope,
  window: AnalyticsWindow,
  dimension: BreakdownDimension
): Promise<BreakdownRow[]> {
  // eslint-disable-next-line security/detect-object-injection -- key is a typed literal, enum value or array index, not user input
  const spec = DIMENSIONS[dimension];
  const rows = await run<
    Array<AggregateRow & { key: string | null; label: string; previous_incidents: number }>
  >(Prisma.sql`
    WITH ${metricRowsCte(scope, window, { includePrevious: true })},
    grouped AS (
      SELECT m.*, ${spec.key} AS key, ${spec.label} AS label
      FROM metric_rows m
      JOIN "Incident" x ON x.id = m.id
      LEFT JOIN "Service" s ON s.id = m."serviceId"
      LEFT JOIN "Team" t ON t.id = COALESCE(x."teamId", s."teamId")
    )
    SELECT key, label,
      ${metricAggregates(Prisma.sql`in_current`)},
      COUNT(*) FILTER (WHERE NOT in_current)::int AS previous_incidents
    FROM grouped
    GROUP BY key, label
    ORDER BY ${spec.order}`);
  return rows.map(row => ({
    key: row.key,
    label: row.label,
    ...toAggregateMetrics(row),
    previousIncidents: Number(row.previous_incidents ?? 0),
  }));
}
