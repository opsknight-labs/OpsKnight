import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { createAnalyticsContext, getAnalyticsSection, parseAnalyticsParams } from '@/lib/analytics';
import { INCIDENT_ALIAS } from '@/lib/analytics/scope';
import { buildAnalyticsCsv, type AnalyticsExportIncident } from '@/lib/analytics-export';
import { jsonError } from '@/lib/api-response';
import { AuthorizationError, CAPABILITIES } from '@/lib/authorization';
import { logger } from '@/lib/logger';
import prisma from '@/lib/prisma';
import { assertCapability, getCurrentAuthorizationActor } from '@/lib/rbac';
import { getUserTimeZone } from '@/lib/timezone';

export const dynamic = 'force-dynamic';

// shortcut: the incident list is capped (and the CSV says so); stream keyset pages if users need more.
const INCIDENT_LIMIT = 10_000;

export async function GET(req: NextRequest) {
  let user: Awaited<ReturnType<typeof assertCapability>>;
  try {
    user = await assertCapability(CAPABILITIES.REPORT_EXPORT);
  } catch (error) {
    return error instanceof AuthorizationError
      ? jsonError('You do not have permission to export analytics.', 403)
      : jsonError('Unauthorized', 401);
  }

  try {
    const actor = await getCurrentAuthorizationActor();
    const params = parseAnalyticsParams(req.nextUrl.searchParams);
    const context = await createAnalyticsContext(actor, params, getUserTimeZone(user));
    const { window, scope } = context;
    const i = Prisma.raw(INCIDENT_ALIAS);

    const [
      kpis,
      services,
      trend,
      responders,
      noise,
      followThrough,
      byTeam,
      byPriority,
      byUrgency,
      availability,
      incidents,
    ] = await Promise.all([
      getAnalyticsSection(context, 'kpis'),
      getAnalyticsSection(context, 'services'),
      getAnalyticsSection(context, 'trend'),
      getAnalyticsSection(context, 'responders'),
      getAnalyticsSection(context, 'noise'),
      getAnalyticsSection(context, 'followThrough'),
      getAnalyticsSection(context, 'breakdownTeam'),
      getAnalyticsSection(context, 'breakdownPriority'),
      getAnalyticsSection(context, 'breakdownUrgency'),
      getAnalyticsSection(context, 'availability'),
      // Same window and actor scope as the sections; one extra row tells the CSV it was capped.
      prisma.$queryRaw<AnalyticsExportIncident[]>(Prisma.sql`
        SELECT ${i}.id, ${i}.title, ${i}.status::text AS status, ${i}.urgency::text AS urgency,
          ${i}.priority, s.name AS service, COALESCE(u.name, u.email) AS assignee,
          ${i}."createdAt", ${i}."acknowledgedAt", ${i}."resolvedAt"
        FROM "Incident" ${i}
        LEFT JOIN "Service" s ON s.id = ${i}."serviceId"
        LEFT JOIN "User" u ON u.id = ${i}."assigneeId"
        WHERE ${i}."createdAt" >= ${window.start} AND ${i}."createdAt" < ${window.end}
          ${scope.incidentSql}
        ORDER BY ${i}."createdAt" DESC, ${i}.id DESC
        LIMIT ${INCIDENT_LIMIT + 1}`),
    ]);

    const csv = buildAnalyticsCsv({
      params,
      window,
      generatedAt: new Date(),
      kpis,
      services,
      trend,
      responders,
      noise,
      followThrough,
      breakdowns: [
        { title: 'team', rows: byTeam },
        { title: 'priority', rows: byPriority },
        { title: 'urgency', rows: byUrgency },
      ],
      availability,
      incidents,
      incidentLimit: INCIDENT_LIMIT,
    });

    // range is an enum value, so the filename is safe by construction.
    const filename = `opsknight-analytics-${params.range}-${new Date().toISOString().slice(0, 10)}.csv`;
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    logger.error('api.analytics.export_error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError('Failed to generate export', 500);
  }
}
