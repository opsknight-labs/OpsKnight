import { z } from 'zod';
import prisma from '@/lib/prisma';
import { defineV2Route, logV2Audit } from '@/lib/api-v2';
import {
  assertDashboardTeam, DashboardIdV2Schema, DashboardWidgetV2Schema,
  dashboardReadWhere, dashboardWidgetCreate, requireCurrentDashboardTeamMembership,
} from '@/lib/api-v2/dashboards';
import { etagHeaders } from '@/lib/api-v2/concurrency';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { AppError } from '@/lib/errors';
import type { Prisma } from '@prisma/client';

const bodySchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  visibility: z.enum(['PRIVATE', 'TEAM', 'PUBLIC']).default('PRIVATE'),
  teamId: z.string().min(1).nullish(),
}).strict();

export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.REPORT_MANAGE,
  paramsSchema: DashboardIdV2Schema,
  bodySchema,
  idempotent: true,
  idempotencyRequired: true,
  idempotencyScope: ({ params }) => `dashboard:${params.id}:duplicate`,
  replayAuthGuard: async ({ params, actor, tx }) => {
    const source = await (tx ?? prisma).dashboard.findFirst({
      where: { id: params.id, AND: [dashboardReadWhere(actor)] }, select: { id: true },
    });
    if (!source) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
  },
  handler: async ({ params, body, actor, apiKey, tx }) => {
    const db = tx ?? prisma;
    const teamId = assertDashboardTeam(actor, body.visibility, body.teamId);
    if (tx) await requireCurrentDashboardTeamMembership(tx, actor.id, teamId);
    const source = await db.dashboard.findFirst({
      where: { id: params.id, AND: [dashboardReadWhere(actor)] },
      include: { widgets: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 51 } },
    });
    if (!source) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
    if (source.widgets.length > 50) {
      throw new AppError({ code: 'RESOURCE_CONFLICT', userMessage: 'Source dashboard has too many widgets to duplicate.' });
    }
    const widgets = source.widgets.map(widget => DashboardWidgetV2Schema.parse({
      widgetType: widget.widgetType, metricKey: widget.metricKey,
      widgetDefinitionId: widget.widgetDefinitionId, title: widget.title,
      position: widget.position, config: widget.config,
    }));
    const dashboard = await db.dashboard.create({
      data: {
        name: body.name ?? `Copy of ${source.name}`.slice(0, 200),
        description: source.description,
        visibility: body.visibility,
        userId: actor.id,
        teamId,
        templateId: source.templateId ?? (source.isTemplate ? source.id : null),
        layout: (source.layout ?? { columns: 4, rowHeight: 120 }) as Prisma.InputJsonValue,
        config: source.config ?? undefined,
        widgets: { create: widgets.map(dashboardWidgetCreate) },
      },
      include: { widgets: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
    });
    await logV2Audit({
      action: 'dashboard.duplicated', entityType: 'DASHBOARD', entityId: dashboard.id,
      actorId: actor.id, apiKeyId: apiKey.id,
      details: { sourceDashboardId: source.id, visibility: dashboard.visibility }, tx,
    });
    return { status: 201, data: dashboard, headers: etagHeaders(dashboard.revision) };
  },
});
