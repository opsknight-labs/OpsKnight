import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { activeIncidentStatuses } from '@/lib/incident-status';
import { analyticsIdSchema } from './params';
import { run } from './queries';
import { INCIDENT_ALIAS, type AnalyticsScope } from './scope';
import { metricRowsCte } from './sql';
import type { AnalyticsWindow } from './window';

/**
 * The incidents behind a KPI number. Built on metricRowsCte, so a drill's
 * total is exactly the numerator the KPI tile counted for the same filters.
 */

export const DRILL_KINDS = [
  'all',
  'open',
  'ackBreached',
  'resolveBreached',
  'escalated',
  'afterHours',
] as const;
export type DrillKind = (typeof DRILL_KINDS)[number];

export const DRILL_PAGE_SIZE = 25;

const CURSOR = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)~([A-Za-z0-9_-]{1,64})$/;

export type DrillCursor = { createdAt: Date; id: string };

export const encodeDrillCursor = (row: { createdAt: Date; id: string }) =>
  `${row.createdAt.toISOString()}~${row.id}`;

/** Query-string input for the drill API; filters themselves go through parseAnalyticsParams. */
export const drillInputSchema = z.object({
  drill: z.enum(DRILL_KINDS).default('all'),
  serviceId: analyticsIdSchema.optional(),
  cursor: z
    .string()
    .max(120)
    .transform((value, ctx): DrillCursor => {
      const match = CURSOR.exec(value);
      const createdAt = match ? new Date(match[1]) : null;
      if (!match || !createdAt || !Number.isFinite(createdAt.getTime())) {
        ctx.addIssue({ code: 'custom', message: 'Invalid cursor' });
        return z.NEVER;
      }
      return { createdAt, id: match[2] };
    })
    .optional(),
});
export type DrillInput = z.infer<typeof drillInputSchema>;

export type DrillIncident = {
  id: string;
  title: string;
  serviceName: string | null;
  urgency: string;
  status: string;
  createdAt: string;
  ackMs: number | null;
  resolveMs: number | null;
};

export type DrillPage = { total: number; incidents: DrillIncident[]; nextCursor: string | null };

const PREDICATE: Record<DrillKind, Prisma.Sql> = {
  all: Prisma.sql`TRUE`,
  open: Prisma.sql`TRUE`,
  ackBreached: Prisma.sql`ack_breached`,
  resolveBreached: Prisma.sql`resolve_breached`,
  escalated: Prisma.sql`escalated`,
  afterHours: Prisma.sql`after_hours`,
};

export async function queryDrilldown(
  scope: AnalyticsScope,
  window: AnalyticsWindow,
  input: DrillInput
): Promise<DrillPage> {
  const a = Prisma.raw(INCIDENT_ALIAS);
  // Extra conditions narrow the actor's scope; they can never widen it.
  let incidentSql = scope.incidentSql;
  if (input.serviceId)
    incidentSql = Prisma.sql`${incidentSql} AND ${a}."serviceId" = ${input.serviceId}`;
  let rowsWindow = window;
  if (input.drill === 'open') {
    // Same set as the KPI "Open now": every active incident in scope, regardless of the period.
    incidentSql = Prisma.sql`${incidentSql}
      AND ${a}."status" = ANY(${activeIncidentStatuses()}::"IncidentStatus"[])`;
    rowsWindow = { ...window, start: new Date(0), end: new Date('9999-01-01T00:00:00Z') };
  }
  const after = input.cursor
    ? Prisma.sql`AND (p."createdAt", p.id) < (${input.cursor.createdAt}, ${input.cursor.id})`
    : Prisma.empty;

  const rows = await run<
    Array<{
      total: number;
      id: string | null;
      title: string;
      service_name: string | null;
      urgency: string;
      status: string;
      createdAt: Date;
      ack_ms: number | null;
      resolve_ms: number | null;
    }>
  >(Prisma.sql`
    WITH ${metricRowsCte({ ...scope, incidentSql }, rowsWindow)},
    picked AS (SELECT * FROM metric_rows WHERE in_current AND ${PREDICATE[input.drill]})
    SELECT c.total, page.*
    FROM (SELECT COUNT(*)::int AS total FROM picked) c
    LEFT JOIN LATERAL (
      SELECT p.id, p.title, s.name AS service_name, p.urgency::text AS urgency,
        p.status::text AS status, p."createdAt", p.ack_ms, p.resolve_ms
      FROM picked p LEFT JOIN "Service" s ON s.id = p."serviceId"
      WHERE TRUE ${after}
      ORDER BY p."createdAt" DESC, p.id DESC
      LIMIT ${DRILL_PAGE_SIZE + 1}
    ) page ON TRUE`);

  const found = rows.filter(row => row.id !== null);
  const incidents = found.slice(0, DRILL_PAGE_SIZE).map(row => ({
    id: row.id as string,
    title: row.title,
    serviceName: row.service_name,
    urgency: row.urgency,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    ackMs: row.ack_ms === null ? null : Number(row.ack_ms),
    resolveMs: row.resolve_ms === null ? null : Number(row.resolve_ms),
  }));
  const last = found.length > DRILL_PAGE_SIZE ? found[DRILL_PAGE_SIZE - 1] : null;
  return {
    total: Number(rows[0]?.total ?? 0),
    incidents,
    nextCursor: last
      ? encodeDrillCursor({ createdAt: last.createdAt, id: last.id as string })
      : null,
  };
}
