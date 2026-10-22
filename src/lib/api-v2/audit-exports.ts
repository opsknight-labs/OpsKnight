import 'server-only';

import { createHash } from 'node:crypto';
import { AuditEntityType, type Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { encrypt } from '@/lib/encryption';
import { AppError } from '@/lib/errors';
import { authorizationActorFromUser } from '@/lib/authorization-actors';
import { authorize, AUTHORIZATION_ACTIONS, type AuthorizationActor } from '@/lib/authorization-policy';
import { projectAuditDetails } from './audit-projection';
import { decryptReportExport } from './report-exports';

export const AUDIT_EXPORT_TTL_MS = 72 * 60 * 60 * 1000;
const MAX_EXPORT_BYTES = 2 * 1024 * 1024;
export const AuditExportFilterSchema = z.object({
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
  action: z.string().trim().min(1).max(100).optional(),
  entityType: z.nativeEnum(AuditEntityType).optional(),
  entityId: z.string().trim().min(1).max(100).optional(),
  actorId: z.string().trim().min(1).max(100).optional(),
  maxRecords: z.number().int().min(1).max(5000).default(5000),
}).strict().refine(value => {
  const from = Date.parse(value.from);
  const to = Date.parse(value.to);
  return from < to && to - from <= 31 * 24 * 60 * 60 * 1000 && to <= Date.now();
}, 'Export window must be historical, ordered, and no longer than 31 days.');
export const AuditExportIdSchema = z.object({ id: z.string().trim().min(1).max(100) }).strict();

export function assertAuditExportAccess(actor: AuthorizationActor) {
  const decision = authorize({ actor, action: AUTHORIZATION_ACTIONS.AUDIT_EXPORT });
  if (!decision.allowed || decision.scope !== 'global') throw new AppError({ code: 'AUTHORIZATION_DENIED' });
}

export async function processAuditExportJob(exportId: string, jobId: string, claimToken?: string | null) {
  const record = await prisma.auditExport.findUnique({
    where: { id: exportId }, include: { job: { select: { status: true, claimToken: true } } },
  });
  if (!record || record.jobId !== jobId || record.expiresAt <= new Date() || record.encryptedPayload) return;
  if (record.job.status !== 'PROCESSING' || record.job.claimToken !== claimToken) return;
  const key = await prisma.apiKey.findUnique({
    where: { id: record.apiKeyId }, select: { id: true, userId: true, scopes: true, revokedAt: true, expiresAt: true },
  });
  if (!key || key.userId !== record.userId || key.revokedAt || (key.expiresAt && key.expiresAt <= new Date())) {
    throw new AppError({ code: 'AUTHORIZATION_DENIED' });
  }
  const user = await prisma.user.findUnique({
    where: { id: record.userId },
    select: { id: true, role: true, status: true, teamMemberships: { select: { teamId: true } } },
  });
  const baseActor = user && authorizationActorFromUser(user);
  if (!baseActor) throw new AppError({ code: 'AUTHORIZATION_DENIED' });
  assertAuditExportAccess({ ...baseActor, apiKey: { id: key.id, scopes: key.scopes } });
  const filter = AuditExportFilterSchema.parse(record.filter);
  const where: Prisma.AuditLogWhereInput = {
    createdAt: { gte: new Date(filter.from), lte: new Date(filter.to) },
    ...(filter.action ? { action: filter.action } : {}),
    ...(filter.entityType ? { entityType: filter.entityType } : {}),
    ...(filter.entityId ? { entityId: filter.entityId } : {}),
    ...(filter.actorId ? { actorId: filter.actorId } : {}),
  };
  const logs = await prisma.auditLog.findMany({
    where, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: filter.maxRecords + 1,
    select: { id: true, action: true, entityType: true, entityId: true,
      actorId: true, actorEmail: true, actorName: true, details: true, ip: true, createdAt: true },
  });
  if (logs.length > filter.maxRecords) {
    throw new AppError({ code: 'RESOURCE_CONFLICT', userMessage: 'Audit export exceeds maxRecords; narrow the filters.' });
  }
  const bytes = Buffer.from(JSON.stringify({
    schemaVersion: 1, generatedAt: new Date().toISOString(), filter,
    recordCount: logs.length,
    records: logs.map(log => ({ ...log, details: projectAuditDetails(log.details) })),
  }));
  if (bytes.length > MAX_EXPORT_BYTES) throw new AppError({ code: 'PAYLOAD_TOO_LARGE' });
  const encryptedPayload = await encrypt(bytes.toString('base64'));
  const checksum = createHash('sha256').update(bytes).digest('hex');
  await prisma.$transaction(async tx => {
    const current = await tx.backgroundJob.findUnique({ where: { id: jobId }, select: { status: true, claimToken: true } });
    if (current?.status !== 'PROCESSING' || current.claimToken !== claimToken) return;
    await tx.auditExport.updateMany({
      where: { id: exportId, encryptedPayload: null, expiresAt: { gt: new Date() } },
      data: { encryptedPayload, checksum, sizeBytes: bytes.length, recordCount: logs.length },
    });
  });
}

export async function decryptAuditExport(payload: string, checksum: string) {
  return decryptReportExport(payload, checksum);
}

export async function expireDueAuditExports(now = new Date()) {
  const due = await prisma.auditExport.findMany({
    where: { expiresAt: { lte: now }, encryptedPayload: { not: null } },
    select: { id: true }, take: 500,
  });
  if (!due.length) return { count: 0 };
  return prisma.auditExport.updateMany({
    where: { id: { in: due.map(item => item.id) }, expiresAt: { lte: now }, encryptedPayload: { not: null } },
    data: { encryptedPayload: null },
  });
}
