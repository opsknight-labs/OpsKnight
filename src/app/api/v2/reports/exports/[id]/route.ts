import prisma from '@/lib/prisma';
import { defineV2Route, enforceV2Authorization } from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { ReportExportIdV2Schema, assertGlobalReportAccess } from '@/lib/api-v2/report-exports';
import { AppError } from '@/lib/errors';

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.REPORT_READ,
  paramsSchema: ReportExportIdV2Schema,
  scopedFilter: true,
  rateLimitTier: 'SEARCH_EXPORT',
  handler: async ({ actor, apiKey, params }) => {
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.INCIDENT_READ);
    assertGlobalReportAccess(actor);
    const report = await prisma.reportExport.findFirst({
      where: { id: params.id, userId: actor.id, apiKeyId: apiKey.id },
      select: {
        id: true, query: true, createdAt: true, expiresAt: true,
        checksum: true, sizeBytes: true, encryptedPayload: true,
        job: { select: { status: true, completedAt: true, failedAt: true } },
      },
    });
    if (!report) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
    return { headers: { 'Cache-Control': 'private, no-store' }, data: {
      id: report.id, query: report.query, createdAt: report.createdAt,
      expiresAt: report.expiresAt,
      status: report.expiresAt <= new Date() ? 'EXPIRED' : report.job.status,
      checksum: report.job.status === 'COMPLETED' ? report.checksum : null,
      sizeBytes: report.job.status === 'COMPLETED' ? report.sizeBytes : null,
      completedAt: report.job.completedAt, failedAt: report.job.failedAt,
    } };
  },
});
