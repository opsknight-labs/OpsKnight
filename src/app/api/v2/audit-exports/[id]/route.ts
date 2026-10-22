import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { defineV2Route } from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { AuditExportIdSchema, assertAuditExportAccess } from '@/lib/api-v2/audit-exports';

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.AUDIT_EXPORT,
  paramsSchema: AuditExportIdSchema, rateLimitTier: 'SEARCH_EXPORT',
  handler: async ({ actor, apiKey, params }) => {
    assertAuditExportAccess(actor);
    const record = await prisma.auditExport.findFirst({
      where: { id: params.id, userId: actor.id, apiKeyId: apiKey.id },
      select: { id: true, filter: true, createdAt: true, expiresAt: true, checksum: true,
        sizeBytes: true, recordCount: true,
        job: { select: { status: true, completedAt: true, failedAt: true } } },
    });
    if (!record) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
    const status = record.expiresAt <= new Date() ? 'EXPIRED' : record.job.status;
    return { headers: { 'Cache-Control': 'private, no-store' }, data: {
      id: record.id, filter: record.filter, createdAt: record.createdAt,
      expiresAt: record.expiresAt, status,
      checksum: status === 'COMPLETED' ? record.checksum : null,
      sizeBytes: status === 'COMPLETED' ? record.sizeBytes : null,
      recordCount: status === 'COMPLETED' ? record.recordCount : null,
      completedAt: record.job.completedAt, failedAt: record.job.failedAt,
    } };
  },
});
