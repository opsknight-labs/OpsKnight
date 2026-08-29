import type { AuditEntityType, Prisma } from '@prisma/client';
import prisma from './prisma';
import { sanitizeContext } from './logger';
import { getRequestContext } from './request-context';

export type AuditDetails = Prisma.InputJsonValue;
export type AuditEventSource =
  | 'UI'
  | 'API'
  | 'INTEGRATION'
  | 'AUTOMATION'
  | 'BACKGROUND'
  | 'AUTH'
  | 'SYSTEM';
export type AuditActorType = 'USER' | 'API_KEY' | 'INTEGRATION' | 'SYSTEM';

export interface AuditEventActor {
  type: AuditActorType;
  id?: string | null;
  email?: string | null;
  name?: string | null;
}

export interface AuditEventTarget {
  type: AuditEntityType;
  id?: string | null;
}

export interface AuditEventInput {
  action: string;
  source: AuditEventSource;
  target: AuditEventTarget;
  actor?: AuditEventActor | null;
  requestId?: string | null;
  occurredAt?: Date;
  oldValue?: AuditDetails | null;
  newValue?: AuditDetails | null;
  metadata?: AuditDetails | null;
  targetEmail?: string | null;
  ip?: string | null;
}

type AuditClient = Pick<Prisma.TransactionClient, 'auditLog' | 'user'>;

function resolveRequestId(value: string | null | undefined): string {
  for (const candidate of [value, getRequestContext().requestId]) {
    const normalized = candidate?.trim();
    if (normalized && /^[A-Za-z0-9._:-]{1,128}$/.test(normalized)) return normalized;
  }
  return crypto.randomUUID();
}

function jsonValue(value: AuditDetails | null | undefined): Prisma.InputJsonValue | null {
  return value === undefined || value === null
    ? null
    : (sanitizeContext(value) as Prisma.InputJsonValue);
}

/** Writes one versioned audit event through the supplied transaction or Prisma client. */
export async function emitAuditEvent(
  input: AuditEventInput,
  client: AuditClient = prisma
): Promise<void> {
  const occurredAt = input.occurredAt ?? new Date();
  if (!Number.isFinite(occurredAt.getTime())) throw new RangeError('Invalid audit timestamp.');

  const actorId = input.actor?.type === 'USER' ? (input.actor.id ?? null) : null;
  const actorSnapshot = actorId
    ? await client.user.findUnique({
        where: { id: actorId },
        select: { email: true, name: true },
      })
    : null;
  const resolvedEmail = input.actor?.email ?? actorSnapshot?.email ?? null;
  const resolvedName = input.actor?.name ?? actorSnapshot?.name ?? null;
  const correlationId = resolveRequestId(input.requestId);
  const targetEmail = input.targetEmail?.toLowerCase().trim() || null;
  const ip = input.ip || null;

  await client.auditLog.create({
    data: {
      action: input.action,
      entityType: input.target.type,
      entityId: input.target.id || null,
      actorId,
      actorEmail: resolvedEmail,
      actorName: resolvedName,
      targetEmail,
      ip,
      details: {
        contractVersion: 1,
        source: input.source,
        requestId: correlationId,
        occurredAt: occurredAt.toISOString(),
        actor: {
          type: input.actor?.type ?? 'SYSTEM',
          id: input.actor?.id ?? null,
          email: resolvedEmail,
          name: resolvedName,
        },
        target: { type: input.target.type, id: input.target.id ?? null },
        oldValue: jsonValue(input.oldValue),
        newValue: jsonValue(input.newValue),
        metadata: jsonValue(input.metadata),
        // Preserve the legacy lookup paths while consumers migrate to the
        // versioned envelope and indexed columns.
        ...(targetEmail ? { targetEmail } : {}),
        ...(ip ? { ip } : {}),
      },
    },
  });
}

/** @deprecated Pass the authenticated actor explicitly for user-initiated actions. */
export async function getDefaultActorId() {
  return null;
}

/** Backward-compatible adapter for existing callers. New code uses emitAuditEvent. */
export async function logAudit(params: {
  action: string;
  entityType: AuditEntityType;
  entityId?: string | null;
  actorId?: string | null;
  details?: AuditDetails | null;
  targetEmail?: string | null;
  ip?: string | null;
  source?: AuditEventSource;
  requestId?: string | null;
  oldValue?: AuditDetails | null;
  newValue?: AuditDetails | null;
}) {
  const detailsRecord =
    params.details && typeof params.details === 'object' && !Array.isArray(params.details)
      ? (params.details as Record<string, unknown>)
      : null;
  const targetEmail =
    params.targetEmail ??
    (typeof detailsRecord?.targetEmail === 'string' ? detailsRecord.targetEmail : null) ??
    (typeof detailsRecord?.email === 'string' ? detailsRecord.email : null);
  const ip = params.ip ?? (typeof detailsRecord?.ip === 'string' ? detailsRecord.ip : null) ?? null;

  await emitAuditEvent({
    action: params.action,
    source: params.source ?? (params.actorId ? 'UI' : 'SYSTEM'),
    target: { type: params.entityType, id: params.entityId },
    actor: params.actorId ? { type: 'USER', id: params.actorId } : { type: 'SYSTEM' },
    requestId: params.requestId,
    oldValue: params.oldValue,
    newValue: params.newValue,
    metadata: params.details,
    targetEmail,
    ip,
  });
}
