import prisma from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import {
  buildCursorWhere,
  defineV2Route,
  formatCursorPagination,
  logV2Audit,
} from '@/lib/api-v2';
import {
  assertDashboardTeam,
  DashboardCreateV2Schema,
  DashboardListV2Schema,
  DashboardWidgetV2Schema,
  dashboardReadWhere,
  dashboardWidgetCreate,
  requireCurrentDashboardTeamMembership,
} from '@/lib/api-v2/dashboards';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { AppError } from '@/lib/errors';

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.REPORT_READ,
  scopedFilter: true,
  querySchema: DashboardListV2Schema,
  handler: async ({ actor, query, pagination }) => {
    const filters: Prisma.DashboardWhereInput[] = [dashboardReadWhere(actor)];
    if (query.search) filters.push({ name: { contains: query.search, mode: 'insensitive' } });
    const cursor = buildCursorWhere(pagination.cursor);
    if (cursor.OR) filters.push(cursor as Prisma.DashboardWhereInput);
    const dashboards = await prisma.dashboard.findMany({
      where: { AND: filters },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: pagination.limit + 1,
      select: {
        id: true, revision: true, name: true, description: true,
        visibility: true, isDefault: true, isTemplate: true, templateId: true,
        userId: true, teamId: true, createdAt: true, updatedAt: true,
        _count: { select: { widgets: true } },
      },
    });
    const result = formatCursorPagination(dashboards, pagination.limit);
    return {
      data: result.data.map(({ _count, ...dashboard }) => ({ ...dashboard, widgetCount: _count.widgets })),
      pagination: result.pagination,
    };
  },
});

export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.REPORT_MANAGE,
  bodySchema: DashboardCreateV2Schema,
  idempotent: true,
  idempotencyRequired: true,
  idempotencyScope: 'dashboard:create',
  handler: async ({ actor, apiKey, body, tx }) => {
    const db = tx ?? prisma;
    const teamId = assertDashboardTeam(actor, body.visibility, body.teamId);
    if (tx) await requireCurrentDashboardTeamMembership(tx, actor.id, teamId);
    let widgets = body.widgets;
    if (body.templateId && widgets.length === 0) {
      const template = await db.dashboard.findFirst({
        where: { id: body.templateId, AND: [dashboardReadWhere(actor)] },
        include: { widgets: { orderBy: { createdAt: 'asc' }, take: 50 } },
      });
      if (!template) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
      widgets = template.widgets.map(widget => DashboardWidgetV2Schema.parse({
        widgetType: widget.widgetType,
        metricKey: widget.metricKey,
        widgetDefinitionId: widget.widgetDefinitionId,
        title: widget.title,
        position: widget.position,
        config: widget.config,
      }));
    }
    const dashboard = await db.dashboard.create({
      data: {
        name: body.name,
        description: body.description ?? null,
        visibility: body.visibility,
        userId: actor.id,
        teamId,
        templateId: body.sourceTemplate ?? body.templateId ?? null,
        layout: { columns: 4, rowHeight: 120 },
        config: { timeRange: 7, refreshInterval: 60 },
        widgets: { create: widgets.map(dashboardWidgetCreate) },
      },
      include: { widgets: { orderBy: { createdAt: 'asc' } } },
    });
    await logV2Audit({
      action: 'dashboard.created', entityType: 'DASHBOARD', entityId: dashboard.id,
      actorId: actor.id, apiKeyId: apiKey.id,
      details: { visibility: dashboard.visibility, teamId: dashboard.teamId }, tx,
    });
    return { status: 201, data: dashboard, headers: { ETag: `"${dashboard.revision}"` } };
  },
});
