import prisma from './prisma';
import { Prisma } from '@prisma/client';
import { sanitizeContext } from './logger';

export type AuditDetails = Prisma.InputJsonValue;

export async function getDefaultActorId() {
  return null;
}

export async function logAudit(params: {
  action: string;
  entityType: 'USER' | 'TEAM' | 'TEAM_MEMBER' | 'SERVICE' | 'ESCALATION_POLICY';
  entityId?: string | null;
  actorId?: string | null;
  details?: AuditDetails | null;
  targetEmail?: string | null;
  ip?: string | null;
}) {
  const { action, entityType, entityId, actorId, details, targetEmail, ip } = params;

  // Extract targetEmail and ip from details if not explicitly passed
  let resolvedEmail = targetEmail ?? null;
  let resolvedIp = ip ?? null;
  if (details && typeof details === 'object' && !Array.isArray(details)) {
    const d = details as Record<string, unknown>;
    if (!resolvedEmail && typeof d.email === 'string') {
      resolvedEmail = d.email;
    }
    if (!resolvedEmail && typeof d.targetEmail === 'string') {
      resolvedEmail = d.targetEmail;
    }
    if (!resolvedIp && typeof d.ip === 'string') {
      resolvedIp = d.ip;
    }
  }

  const safeDetails = details ? (sanitizeContext(details) as Prisma.InputJsonValue) : Prisma.DbNull;

  await prisma.auditLog.create({
    data: {
      action,
      entityType,
      entityId: entityId || null,
      actorId: actorId || null,
      details: safeDetails,
      targetEmail: resolvedEmail ? resolvedEmail.toLowerCase().trim() : null,
      ip: resolvedIp || null,
    },
  });
}
