import { type Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { defineV2Route, logV2Audit } from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { AuditExportFilterSchema, AUDIT_EXPORT_TTL_MS, assertAuditExportAccess } from '@/lib/api-v2/audit-exports';

export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.AUDIT_EXPORT,
  bodySchema: AuditExportFilterSchema,
  rateLimitTier: 'SEARCH_EXPORT',
  idempotent: true, idempotencyRequired: true,
  replayAuthGuard: async ({ actor }) => { assertAuditExportAccess(actor); },
  handler: async ({ actor, apiKey, body, tx }) => {
    assertAuditExportAccess(actor);
    const db = tx ?? prisma;
    // Serialize admission across credentials, including the global in-flight cap.
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('api:v2:audit-export-admission', 0))`;
    const active: Prisma.AuditExportWhereInput = { job: { status: { in: ['PENDING', 'PROCESSING'] } } };
    const [credentialCount, globalCount] = await Promise.all([
      db.auditExport.count({ where: { ...active, apiKeyId: apiKey.id } }),
      db.auditExport.count({ where: active }),
    ]);
    if (credentialCount >= 2 || globalCount >= 4) {
      throw new AppError({ code: 'RATE_LIMIT_EXCEEDED', userMessage: 'Too many audit exports are in progress.' });
    }
    const job = await db.backgroundJob.create({
      data: { type: 'AUDIT_EXPORT', status: 'PENDING', scheduledAt: new Date(), payload: {} },
    });
    const record = await db.auditExport.create({
      data: { userId: actor.id, apiKeyId: apiKey.id, jobId: job.id,
        filter: body as Prisma.InputJsonObject,
        expiresAt: new Date(Date.now() + AUDIT_EXPORT_TTL_MS) },
    });
    await db.backgroundJob.update({ where: { id: job.id }, data: { payload: { exportId: record.id } } });
    await logV2Audit({
      action: 'audit.export.requested', entityType: 'AUDIT_EXPORT', entityId: record.id,
      actorId: actor.id, apiKeyId: apiKey.id,
      details: { from: body.from, to: body.to, maxRecords: body.maxRecords }, tx,
    });
    return { status: 201, headers: { 'Cache-Control': 'private, no-store' }, data: {
      id: record.id, status: 'PENDING', createdAt: record.createdAt,
      expiresAt: record.expiresAt, filter: body,
    } };
  },
});
