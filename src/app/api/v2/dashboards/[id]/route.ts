import prisma from '@/lib/prisma';
import {
  defineV2Route,
  logV2Audit,
} from '@/lib/api-v2';
import {
  assertDashboardTeam,
  DashboardIdV2Schema,
  DashboardUpdateV2Schema,
  dashboardReadWhere,
  dashboardWidgetCreate,
  requireCurrentDashboardTeamMembership,
} from '@/lib/api-v2/dashboards';
import { etagHeaders, requireRevisionIfMatch, withIfMatch } from '@/lib/api-v2/concurrency';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { AppError } from '@/lib/errors';
import type { Prisma } from '@prisma/client';

async function requireOwnedDashboard(id: string, ownerId: string, db: Prisma.TransactionClient | typeof prisma) {
  const dashboard = await db.dashboard.findFirst({
    where: { id, userId: ownerId, isTemplate: false },
    select: { id: true, visibility: true, teamId: true, revision: true },
  });
  if (!dashboard) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
  return dashboard;
}

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.REPORT_READ,
  paramsSchema: DashboardIdV2Schema,
  scopedFilter: true,
  handler: async ({ params, actor }) => {
    const dashboard = await prisma.dashboard.findFirst({
      where: { id: params.id, AND: [dashboardReadWhere(actor)] },
      include: {
        widgets: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 50 },
        user: { select: { id: true, name: true } },
        team: { select: { id: true, name: true } },
      },
    });
    if (!dashboard) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
    return {
      data: { ...dashboard, permissions: {
        canEdit: dashboard.userId === actor.id && !dashboard.isTemplate,
        canDelete: dashboard.userId === actor.id && !dashboard.isTemplate,
      } },
      headers: etagHeaders(dashboard.revision),
    };
  },
});

export const PATCH = defineV2Route({
  action: AUTHORIZATION_ACTIONS.REPORT_MANAGE,
  paramsSchema: DashboardIdV2Schema,
  bodySchema: DashboardUpdateV2Schema,
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  idempotencyScope: ({ params }) => `dashboard:${params.id}:update`,
  replayAuthGuard: async ({ params, actor, tx }) => {
    const current = await requireOwnedDashboard(params.id, actor.id, tx ?? prisma);
    if (tx) await requireCurrentDashboardTeamMembership(tx, actor.id, current.teamId);
  },
  handler: async ({ req, params, body, actor, apiKey, tx }) => {
    const db = tx ?? prisma;
    const expected = requireRevisionIfMatch(req);
    const existing = await requireOwnedDashboard(params.id, actor.id, db);
    const visibility = body.visibility ?? existing.visibility;
    const teamId = assertDashboardTeam(
      actor,
      visibility,
      body.teamId === undefined ? (visibility === 'TEAM' ? existing.teamId : null) : body.teamId
    );
    if (tx) await requireCurrentDashboardTeamMembership(tx, actor.id, teamId);
    const dashboard = await withIfMatch(expected, async () => {
      const updated = await db.dashboard.update({
        where: { id: params.id, userId: actor.id, isTemplate: false, revision: expected },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.visibility !== undefined ? { visibility } : {}),
          ...(body.visibility !== undefined || body.teamId !== undefined ? { teamId } : {}),
          ...(body.layout !== undefined ? { layout: body.layout } : {}),
          ...(body.config !== undefined ? { config: body.config } : {}),
          // A child-only edit must still advance the parent revision.
          ...(body.widgets !== undefined && Object.keys(body).length === 1 ? { updatedAt: new Date() } : {}),
        },
      });
      if (body.widgets !== undefined) {
        await db.dashboardWidget.deleteMany({ where: { dashboardId: params.id } });
        if (body.widgets.length > 0) {
          await db.dashboardWidget.createMany({
            data: body.widgets.map(widget => ({ dashboardId: params.id, ...dashboardWidgetCreate(widget) })),
          });
        }
      }
      return db.dashboard.findUniqueOrThrow({
        where: { id: updated.id },
        include: { widgets: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 50 } },
      });
    });
    await logV2Audit({
      action: 'dashboard.updated', entityType: 'DASHBOARD', entityId: dashboard.id,
      actorId: actor.id, apiKeyId: apiKey.id,
      details: { fields: Object.keys(body), visibility: dashboard.visibility }, tx,
    });
    return { data: dashboard, headers: etagHeaders(dashboard.revision) };
  },
});

export const DELETE = defineV2Route({
  action: AUTHORIZATION_ACTIONS.REPORT_MANAGE,
  paramsSchema: DashboardIdV2Schema,
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  idempotencyScope: ({ params }) => `dashboard:${params.id}:delete`,
  replayAuthGuard: async ({ params, actor, tx }) => {
    // A successful deletion has no live resource to reauthorize. The receipt is
    // deliberately not replayable; a second call receives 404.
    await requireOwnedDashboard(params.id, actor.id, tx ?? prisma);
  },
  handler: async ({ req, params, actor, apiKey, tx }) => {
    const db = tx ?? prisma;
    const expected = requireRevisionIfMatch(req);
    await requireOwnedDashboard(params.id, actor.id, db);
    await withIfMatch(expected, () => db.dashboard.delete({
      where: { id: params.id, userId: actor.id, isTemplate: false, revision: expected },
    }));
    await logV2Audit({
      action: 'dashboard.deleted', entityType: 'DASHBOARD', entityId: params.id,
      actorId: actor.id, apiKeyId: apiKey.id, details: {}, tx,
    });
    return { status: 204 };
  },
});
