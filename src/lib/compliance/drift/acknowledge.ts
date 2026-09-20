import type { PrismaClient } from '@prisma/client';
import prismaClient from '../../prisma';
import { emitAuditEvent } from '../../audit';

export class DriftNotFoundError extends Error {
  constructor(id: string) {
    super(`Compliance drift event ${id} not found.`);
    this.name = 'DriftNotFoundError';
  }
}

export class DriftAlreadyResolvedError extends Error {
  constructor(id: string) {
    super(`Compliance drift event ${id} is already resolved and cannot be acknowledged.`);
    this.name = 'DriftAlreadyResolvedError';
  }
}

/**
 * Acknowledges an active drift event by an authorized operator.
 *
 * Important semantics:
 * - Acknowledgement records operator awareness.
 * - Acknowledgement NEVER resolves the drift event. Factual resolution occurs
 *   only when technical evaluation confirms recovery.
 */
export async function acknowledgeComplianceDrift(params: {
  driftEventId: string;
  userId: string;
  prisma?: PrismaClient;
  now?: Date;
}) {
  const prisma = params.prisma ?? prismaClient;
  const now = params.now ?? new Date();

  const event = await prisma.complianceDriftEvent.findUnique({
    where: { id: params.driftEventId },
  });

  if (!event) {
    throw new DriftNotFoundError(params.driftEventId);
  }

  if (event.status === 'RESOLVED') {
    throw new DriftAlreadyResolvedError(params.driftEventId);
  }

  const updated = await prisma.complianceDriftEvent.update({
    where: { id: params.driftEventId },
    data: {
      status: 'ACKNOWLEDGED',
      acknowledgedAt: now,
      acknowledgedByUserId: params.userId,
    },
  });

  await emitAuditEvent({
    action: 'COMPLIANCE_DRIFT_ACKNOWLEDGED',
    source: 'UI',
    target: { type: 'COMPLIANCE_DRIFT_EVENT', id: event.id },
    actor: { type: 'USER', id: params.userId },
    occurredAt: now,
    metadata: {
      controlId: event.controlId,
      kind: event.kind,
      status: 'ACKNOWLEDGED',
    },
  });

  return updated;
}
