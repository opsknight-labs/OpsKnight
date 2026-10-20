import prisma from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { defineV2Route, enforceV2Authorization, logV2Audit } from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { ReportExportRequestV2Schema, REPORT_EXPORT_TTL_MS, assertGlobalReportAccess } from '@/lib/api-v2/report-exports';
import { AppError } from '@/lib/errors';

export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.REPORT_READ,
  bodySchema: ReportExportRequestV2Schema,
  rateLimitTier: 'SEARCH_EXPORT',
  scopedFilter: true,
  idempotent: true,
  idempotencyRequired: true,
  idempotencyScope: 'report-export:create',
  replayAuthGuard: async ({ actor }) => {
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.INCIDENT_READ);
    assertGlobalReportAccess(actor);
  },
  handler: async ({ actor, apiKey, body, tx }) => {
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.INCIDENT_READ);
    assertGlobalReportAccess(actor);
    const db = tx ?? prisma;
    const active: Prisma.ReportExportWhereInput = { job: { status: { in: ['PENDING', 'PROCESSING'] } } };
    const [credentialCount, globalCount] = await Promise.all([
      db.reportExport.count({ where: { ...active, apiKeyId: apiKey.id } }),
      db.reportExport.count({ where: active }),
    ]);
    if (credentialCount >= 2 || globalCount >= 4) {
      throw new AppError({ code: 'RATE_LIMIT_EXCEEDED', userMessage: 'Too many report exports are in progress.' });
    }
    const job = await db.backgroundJob.create({
      data: { type: 'REPORT_EXPORT', status: 'PENDING', scheduledAt: new Date(), payload: {} },
    });
    const report = await db.reportExport.create({
      data: {
        userId: actor.id, apiKeyId: apiKey.id, jobId: job.id,
        query: body as Prisma.InputJsonObject,
        expiresAt: new Date(Date.now() + REPORT_EXPORT_TTL_MS),
      },
    });
    await db.backgroundJob.update({
      where: { id: job.id }, data: { payload: { exportId: report.id } },
    });
    await logV2Audit({
      action: 'report.export.requested', entityType: 'REPORT_EXPORT', entityId: report.id,
      actorId: actor.id, apiKeyId: apiKey.id,
      details: { windowDays: body.windowDays, metricCount: body.metrics.length }, tx,
    });
    return { status: 201, headers: { 'Cache-Control': 'private, no-store' }, data: {
      id: report.id, status: 'PENDING', createdAt: report.createdAt,
      expiresAt: report.expiresAt, query: body,
    } };
  },
});
