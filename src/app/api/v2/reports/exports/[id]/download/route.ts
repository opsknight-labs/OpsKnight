import prisma from '@/lib/prisma';
import { defineV2Route, enforceV2Authorization, logV2Audit } from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { ReportExportIdV2Schema, assertGlobalReportAccess, decryptReportExport } from '@/lib/api-v2/report-exports';
import { AppError } from '@/lib/errors';

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.REPORT_READ,
  paramsSchema: ReportExportIdV2Schema,
  scopedFilter: true,
  rateLimitTier: 'SEARCH_EXPORT',
  handler: async ({ actor, apiKey, params, rateLimitHeaders }) => {
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.INCIDENT_READ);
    assertGlobalReportAccess(actor);
    const report = await prisma.reportExport.findFirst({
      where: { id: params.id, userId: actor.id, apiKeyId: apiKey.id },
      include: { job: { select: { status: true } } },
    });
    if (!report || report.expiresAt <= new Date()) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
    if (report.job.status !== 'COMPLETED' || !report.encryptedPayload || !report.checksum) {
      throw new AppError({ code: 'RESOURCE_CONFLICT', userMessage: 'The report export is not ready.' });
    }
    const bytes = await decryptReportExport(report.encryptedPayload, report.checksum);
    await prisma.$transaction(async tx => {
      const stillAvailable = await tx.reportExport.count({
        where: { id: report.id, userId: actor.id, apiKeyId: apiKey.id,
          expiresAt: { gt: new Date() }, encryptedPayload: { not: null } },
      });
      if (!stillAvailable) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
      await logV2Audit({
        action: 'report.export.downloaded', entityType: 'REPORT_EXPORT', entityId: report.id,
        actorId: actor.id, apiKeyId: apiKey.id,
        details: { checksum: report.checksum, sizeBytes: report.sizeBytes }, tx,
      });
    });
    return new Response(new Uint8Array(bytes), {
      headers: {
        ...rateLimitHeaders,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="opsknight-report-${report.id}.json"`,
        'Content-Length': String(bytes.length),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Content-SHA256': report.checksum,
      },
    });
  },
});
