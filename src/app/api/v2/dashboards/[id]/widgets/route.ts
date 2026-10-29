import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { defineV2Route, logV2Audit } from '@/lib/api-v2';
import {
  DashboardIdV2Schema,
  DashboardWidgetV2Schema,
  dashboardReadWhere,
  dashboardWidgetCreate,
  requireCurrentDashboardTeamMembership,
} from '@/lib/api-v2/dashboards';
import { etagHeaders, requireRevisionIfMatch, withIfMatch } from '@/lib/api-v2/concurrency';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { AppError } from '@/lib/errors';

const bodySchema = z.object({ widgets: z.array(DashboardWidgetV2Schema).max(50) }).strict();

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.REPORT_READ,
  paramsSchema: DashboardIdV2Schema,
  scopedFilter: true,
  handler: async ({ actor, params }) => {
    const dashboard = await prisma.dashboard.findFirst({
      where: { id: params.id, AND: [dashboardReadWhere(actor)] },
      select: {
        id: true,
        revision: true,
        widgets: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 50 },
      },
    });
    if (!dashboard) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
    return {
      data: { dashboardId: dashboard.id, widgets: dashboard.widgets },
      headers: etagHeaders(dashboard.revision),
    };
  },
});

export const PUT = defineV2Route({
  action: AUTHORIZATION_ACTIONS.REPORT_MANAGE,
  paramsSchema: DashboardIdV2Schema,
  bodySchema,
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  idempotencyScope: ({ params }) => `dashboard:${params.id}:widgets`,
  replayAuthGuard: async ({ params, actor, tx }) => {
    const existing = await (tx ?? prisma).dashboard.findFirst({
      where: { id: params.id, userId: actor.id, isTemplate: false },
      select: { teamId: true },
    });
    if (!existing) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
    if (tx) await requireCurrentDashboardTeamMembership(tx, actor.id, existing.teamId);
  },
  handler: async ({ req, params, body, actor, apiKey, tx }) => {
    const db = tx ?? prisma;
    const existing = await db.dashboard.findFirst({
      where: { id: params.id, userId: actor.id, isTemplate: false },
      select: { id: true, teamId: true },
    });
    if (!existing) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
    if (tx) await requireCurrentDashboardTeamMembership(tx, actor.id, existing.teamId);
    const expected = requireRevisionIfMatch(req);
    const updated = await withIfMatch(expected, async () => {
      await db.dashboard.update({
        where: { id: params.id, userId: actor.id, isTemplate: false, revision: expected },
        data: { updatedAt: new Date() },
      });
      await db.dashboardWidget.deleteMany({ where: { dashboardId: params.id } });
      if (body.widgets.length > 0) {
        await db.dashboardWidget.createMany({
          data: body.widgets.map(widget => ({
            dashboardId: params.id,
            ...dashboardWidgetCreate(widget),
          })),
        });
      }
      return db.dashboard.findUniqueOrThrow({
        where: { id: params.id },
        select: {
          id: true,
          revision: true,
          widgets: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 50 },
        },
      });
    });
    await logV2Audit({
      action: 'dashboard.widgets_replaced',
      entityType: 'DASHBOARD',
      entityId: params.id,
      actorId: actor.id,
      apiKeyId: apiKey.id,
      details: { widgetCount: updated.widgets.length },
      tx,
    });
    return {
      data: { dashboardId: updated.id, widgets: updated.widgets },
      headers: etagHeaders(updated.revision),
    };
  },
});
