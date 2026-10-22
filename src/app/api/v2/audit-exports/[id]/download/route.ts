import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { defineV2Route, logV2Audit } from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { AuditExportIdSchema, assertAuditExportAccess, decryptAuditExport } from '@/lib/api-v2/audit-exports';

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.AUDIT_EXPORT,
  paramsSchema: AuditExportIdSchema, rateLimitTier: 'SEARCH_EXPORT',
  handler: async ({ actor, apiKey, params, rateLimitHeaders }) => {
    assertAuditExportAccess(actor);
    const record = await prisma.auditExport.findFirst({
      where: { id: params.id, userId: actor.id, apiKeyId: apiKey.id },
      include: { job: { select: { status: true } } },
    });
    if (!record || record.expiresAt <= new Date()) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
    if (record.job.status !== 'COMPLETED' || !record.encryptedPayload || !record.checksum) {
      throw new AppError({ code: 'RESOURCE_CONFLICT', userMessage: 'The audit export is not ready.' });
    }
    const bytes = await decryptAuditExport(record.encryptedPayload, record.checksum);
    await prisma.$transaction(async tx => {
      const valid = await tx.auditExport.count({
        where: { id: record.id, userId: actor.id, apiKeyId: apiKey.id,
          expiresAt: { gt: new Date() }, encryptedPayload: { not: null } },
      });
      if (!valid) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
      await logV2Audit({
        action: 'audit.export.downloaded', entityType: 'AUDIT_EXPORT', entityId: record.id,
        actorId: actor.id, apiKeyId: apiKey.id,
        details: { checksum: record.checksum, sizeBytes: record.sizeBytes }, tx,
      });
    });
    return new Response(new Uint8Array(bytes), { headers: {
      ...rateLimitHeaders,
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="opsknight-audit-${record.id}.json"`,
      'Content-Length': String(bytes.length),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Content-SHA256': record.checksum,
    } });
  },
});
