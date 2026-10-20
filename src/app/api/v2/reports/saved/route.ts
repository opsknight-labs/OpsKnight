import prisma from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import {
  buildCursorWhere, defineV2Route, formatCursorPagination, logV2Audit,
} from '@/lib/api-v2';
import {
  SavedReportCreateV2Schema, SavedReportListV2Schema, savedReportReadWhere,
} from '@/lib/api-v2/saved-reports';
import {
  assertDashboardTeam, requireCurrentDashboardTeamMembership,
} from '@/lib/api-v2/dashboards';
import { etagHeaders } from '@/lib/api-v2/concurrency';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.REPORT_READ,
  scopedFilter: true,
  querySchema: SavedReportListV2Schema,
  handler: async ({ actor, query, pagination }) => {
    const filters: Prisma.SavedReportWhereInput[] = [savedReportReadWhere(actor)];
    if (query.search) filters.push({ name: { contains: query.search, mode: 'insensitive' } });
    const cursor = buildCursorWhere(pagination.cursor);
    if (cursor.OR) filters.push(cursor as Prisma.SavedReportWhereInput);
    const reports = await prisma.savedReport.findMany({
      where: { AND: filters },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: pagination.limit + 1,
    });
    const result = formatCursorPagination(reports, pagination.limit);
    return { data: result.data, pagination: result.pagination };
  },
});

export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.REPORT_MANAGE,
  bodySchema: SavedReportCreateV2Schema,
  idempotent: true,
  idempotencyRequired: true,
  idempotencyScope: 'saved-report:create',
  handler: async ({ actor, apiKey, body, tx }) => {
    const db = tx ?? prisma;
    const teamId = assertDashboardTeam(actor, body.visibility, body.teamId);
    if (tx) await requireCurrentDashboardTeamMembership(tx, actor.id, teamId);
    const report = await db.savedReport.create({
      data: {
        name: body.name, description: body.description ?? null,
        metricKeys: body.metrics, windowDays: body.windowDays,
        serviceId: body.serviceId ?? null, visibility: body.visibility,
        userId: actor.id, teamId,
      },
    });
    await logV2Audit({
      action: 'report.saved.created', entityType: 'SAVED_REPORT', entityId: report.id,
      actorId: actor.id, apiKeyId: apiKey.id,
      details: { visibility: report.visibility, teamId: report.teamId, metricCount: report.metricKeys.length }, tx,
    });
    return { status: 201, data: report, headers: etagHeaders(report.revision) };
  },
});
