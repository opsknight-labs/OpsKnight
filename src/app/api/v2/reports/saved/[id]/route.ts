import prisma from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { defineV2Route, logV2Audit } from '@/lib/api-v2';
import {
  SavedReportIdV2Schema, SavedReportUpdateV2Schema, savedReportReadWhere,
} from '@/lib/api-v2/saved-reports';
import {
  assertDashboardTeam, requireCurrentDashboardTeamMembership,
} from '@/lib/api-v2/dashboards';
import { etagHeaders, requireRevisionIfMatch, withIfMatch } from '@/lib/api-v2/concurrency';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { AppError } from '@/lib/errors';

async function owned(id: string, actorId: string, db: Prisma.TransactionClient | typeof prisma) {
  const report = await db.savedReport.findFirst({
    where: { id, userId: actorId },
    select: { id: true, revision: true, visibility: true, teamId: true },
  });
  if (!report) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
  return report;
}

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.REPORT_READ,
  paramsSchema: SavedReportIdV2Schema,
  scopedFilter: true,
  handler: async ({ actor, params }) => {
    const report = await prisma.savedReport.findFirst({
      where: { id: params.id, AND: [savedReportReadWhere(actor)] },
    });
    if (!report) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
    return { data: { ...report, canEdit: report.userId === actor.id },
      headers: etagHeaders(report.revision) };
  },
});

export const PATCH = defineV2Route({
  action: AUTHORIZATION_ACTIONS.REPORT_MANAGE,
  paramsSchema: SavedReportIdV2Schema,
  bodySchema: SavedReportUpdateV2Schema,
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  idempotencyScope: ({ params }) => `saved-report:${params.id}:update`,
  replayAuthGuard: async ({ actor, params, tx }) => {
    const current = await owned(params.id, actor.id, tx ?? prisma);
    if (tx) await requireCurrentDashboardTeamMembership(tx, actor.id, current.teamId);
  },
  handler: async ({ req, actor, apiKey, params, body, tx }) => {
    const db = tx ?? prisma;
    const existing = await owned(params.id, actor.id, db);
    const expected = requireRevisionIfMatch(req);
    const visibility = body.visibility ?? existing.visibility;
    const teamId = assertDashboardTeam(actor, visibility,
      body.teamId === undefined ? (visibility === 'TEAM' ? existing.teamId : null) : body.teamId);
    if (tx) await requireCurrentDashboardTeamMembership(tx, actor.id, teamId);
    const report = await withIfMatch(expected, () => db.savedReport.update({
      where: { id: params.id, userId: actor.id, revision: expected },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.metrics !== undefined ? { metricKeys: body.metrics } : {}),
        ...(body.windowDays !== undefined ? { windowDays: body.windowDays } : {}),
        ...(body.serviceId !== undefined ? { serviceId: body.serviceId } : {}),
        ...(body.visibility !== undefined ? { visibility } : {}),
        ...(body.visibility !== undefined || body.teamId !== undefined ? { teamId } : {}),
      },
    }));
    await logV2Audit({
      action: 'report.saved.updated', entityType: 'SAVED_REPORT', entityId: report.id,
      actorId: actor.id, apiKeyId: apiKey.id,
      details: { fields: Object.keys(body), visibility: report.visibility }, tx,
    });
    return { data: report, headers: etagHeaders(report.revision) };
  },
});

export const DELETE = defineV2Route({
  action: AUTHORIZATION_ACTIONS.REPORT_MANAGE,
  paramsSchema: SavedReportIdV2Schema,
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  idempotencyScope: ({ params }) => `saved-report:${params.id}:delete`,
  replayAuthGuard: async ({ actor, params, tx }) => {
    await owned(params.id, actor.id, tx ?? prisma);
  },
  handler: async ({ req, actor, apiKey, params, tx }) => {
    const db = tx ?? prisma;
    await owned(params.id, actor.id, db);
    const expected = requireRevisionIfMatch(req);
    await withIfMatch(expected, () => db.savedReport.delete({
      where: { id: params.id, userId: actor.id, revision: expected },
    }));
    await logV2Audit({
      action: 'report.saved.deleted', entityType: 'SAVED_REPORT', entityId: params.id,
      actorId: actor.id, apiKeyId: apiKey.id, details: {}, tx,
    });
    return { status: 204 };
  },
});
