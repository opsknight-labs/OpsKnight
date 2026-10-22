import prisma from '@/lib/prisma';
import { defineV2Route, enforceV2Authorization, logV2Audit } from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { ReportExportIdV2Schema, assertGlobalReportAccess } from '@/lib/api-v2/report-exports';
import { AppError } from '@/lib/errors';

export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.REPORT_READ,
  paramsSchema: ReportExportIdV2Schema,
  scopedFilter: true,
  idempotent: true,
  idempotencyRequired: true,
  idempotencyScope: ({ params }) => `report-export:${params.id}:cancel`,
  replayAuthGuard: async ({ actor, apiKey, params, tx }) => {
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.INCIDENT_READ);
    assertGlobalReportAccess(actor);
    const report = await (tx ?? prisma).reportExport.count({
      where: { id: params.id, userId: actor.id, apiKeyId: apiKey.id },
    });
    if (!report) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
  },
  handler: async ({ actor, apiKey, params, tx }) => {
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.INCIDENT_READ);
    assertGlobalReportAccess(actor);
    const db = tx ?? prisma;
    const report = await db.reportExport.findFirst({
      where: { id: params.id, userId: actor.id, apiKeyId: apiKey.id },
      select: { id: true, jobId: true },
    });
    if (!report) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
    const changed = await db.backgroundJob.updateMany({
      where: { id: report.jobId, status: 'PENDING' },
      data: { status: 'CANCELLED', completedAt: new Date() },
    });
    if (!changed.count) {
      const job = await db.backgroundJob.findUnique({
        where: { id: report.jobId }, select: { status: true },
      });
      if (job?.status !== 'CANCELLED') {
        throw new AppError({ code: 'RESOURCE_CONFLICT', userMessage: 'Only pending report exports can be cancelled.' });
      }
    } else {
      await logV2Audit({
        action: 'report.export.cancelled', entityType: 'REPORT_EXPORT', entityId: report.id,
        actorId: actor.id, apiKeyId: apiKey.id, details: {}, tx,
      });
    }
    return { headers: { 'Cache-Control': 'private, no-store' }, data: { id: report.id, status: 'CANCELLED' } };
  },
});
