import 'server-only';

import type {
  PrivacyRequestStatus,
  PrivacyRequestSubjectType,
  PrivacyRequestType,
} from '@prisma/client';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { emitAuditEvent } from '@/lib/audit';
import { AppError } from '@/lib/errors/app-error';

/**
 * Request types that Phase 2 can actually fulfil end to end. Every other type
 * is schema/UI-visible but must be shown as "Not yet automated" and handled
 * manually until a later phase implements it.
 */
export const AUTOMATED_PRIVACY_REQUEST_TYPES: readonly PrivacyRequestType[] = [
  'ACCESS',
  'PORTABILITY',
];

export function isAutomatedPrivacyRequestType(requestType: PrivacyRequestType): boolean {
  return AUTOMATED_PRIVACY_REQUEST_TYPES.includes(requestType);
}

/**
 * Centralized state machine. COMPLETED and REJECTED are terminal: a finished
 * request cannot be silently reopened by a stray UI/API call.
 */
const ALLOWED_TRANSITIONS: Record<PrivacyRequestStatus, readonly PrivacyRequestStatus[]> = {
  RECEIVED: ['IDENTITY_VERIFICATION', 'IN_REVIEW', 'REJECTED'],
  IDENTITY_VERIFICATION: ['IN_REVIEW', 'BLOCKED', 'REJECTED'],
  IN_REVIEW: ['PROCESSING', 'BLOCKED', 'REJECTED'],
  PROCESSING: ['COMPLETED', 'BLOCKED', 'REJECTED'],
  BLOCKED: ['IN_REVIEW', 'PROCESSING', 'REJECTED'],
  COMPLETED: [],
  REJECTED: [],
};

const createPrivacyRequestSchema = z.object({
  subjectType: z.enum(['USER', 'STATUS_SUBSCRIBER']).default('USER'),
  subjectId: z.string().trim().min(1).max(191),
  requestType: z.enum([
    'ACCESS',
    'RECTIFICATION',
    'ERASURE',
    'RESTRICTION',
    'OBJECTION',
    'PORTABILITY',
  ]),
  notes: z.string().trim().max(4000).optional(),
});

export type CreatePrivacyRequestInput = z.infer<typeof createPrivacyRequestSchema>;

const transitionPrivacyRequestSchema = z.object({
  requestId: z.string().cuid(),
  toStatus: z.enum([
    'RECEIVED',
    'IDENTITY_VERIFICATION',
    'IN_REVIEW',
    'PROCESSING',
    'BLOCKED',
    'COMPLETED',
    'REJECTED',
  ]),
  rejectionReason: z.string().trim().max(4000).optional(),
  notes: z.string().trim().max(4000).optional(),
});

export type TransitionPrivacyRequestInput = z.infer<typeof transitionPrivacyRequestSchema>;

const assignPrivacyRequestSchema = z.object({
  requestId: z.string().cuid(),
  assignedToId: z.string().cuid().nullable(),
});

export type AssignPrivacyRequestInput = z.infer<typeof assignPrivacyRequestSchema>;

export interface PrivacyRequestActor {
  id: string;
}

/** Creates a request in RECEIVED status. Subject identity is fixed at creation time. */
export async function createPrivacyRequest(input: unknown, actor: PrivacyRequestActor) {
  const parsed = createPrivacyRequestSchema.parse(input);

  return prisma.$transaction(async tx => {
    const request = await tx.privacyRequest.create({
      data: {
        subjectType: parsed.subjectType as PrivacyRequestSubjectType,
        subjectId: parsed.subjectId,
        requestType: parsed.requestType as PrivacyRequestType,
        notes: parsed.notes,
        requestedById: actor.id,
      },
    });

    await emitAuditEvent(
      {
        action: 'privacy.request.created',
        source: 'UI',
        target: { type: 'PRIVACY_REQUEST', id: request.id },
        actor: { type: 'USER', id: actor.id },
        metadata: {
          subjectType: request.subjectType,
          requestType: request.requestType,
          automated: isAutomatedPrivacyRequestType(request.requestType),
        },
      },
      tx
    );

    return request;
  });
}

/**
 * The only sanctioned way to change a PrivacyRequest's status. Validates the
 * transition against the state machine and uses an optimistic-lock update so
 * two concurrent transitions can't silently clobber one another.
 */
export async function transitionPrivacyRequest(input: unknown, actor: PrivacyRequestActor) {
  const parsed = transitionPrivacyRequestSchema.parse(input);

  if (parsed.toStatus === 'REJECTED' && !parsed.rejectionReason) {
    throw new AppError({
      code: 'VALIDATION_FAILED',
      userMessage: 'A rejection reason is required to reject a privacy request.',
      fields: [{ field: 'rejectionReason', message: 'Required when rejecting a request.' }],
    });
  }

  return prisma.$transaction(async tx => {
    const current = await tx.privacyRequest.findUnique({ where: { id: parsed.requestId } });
    if (!current) {
      throw new AppError({ code: 'PRIVACY_REQUEST_NOT_FOUND' });
    }

    // Re-requesting the current status is a safe no-op, not an error — this
    // makes double-submits (e.g. a retried request) idempotent.
    if (current.status === parsed.toStatus) {
      return current;
    }

    const allowed = ALLOWED_TRANSITIONS[current.status] ?? [];
    if (!allowed.includes(parsed.toStatus)) {
      throw new AppError({
        code: 'PRIVACY_REQUEST_INVALID_TRANSITION',
        details: { from: current.status, to: parsed.toStatus },
      });
    }

    const now = new Date();
    const data: Record<string, unknown> = { status: parsed.toStatus };
    if (parsed.notes !== undefined) data.notes = parsed.notes;
    if (current.status === 'IDENTITY_VERIFICATION' && parsed.toStatus !== 'IDENTITY_VERIFICATION') {
      data.verifiedAt = current.verifiedAt ?? now;
    }
    if (parsed.toStatus === 'COMPLETED') data.completedAt = now;
    if (parsed.toStatus === 'REJECTED') data.rejectionReason = parsed.rejectionReason;

    const updateResult = await tx.privacyRequest.updateMany({
      where: { id: parsed.requestId, status: current.status },
      data,
    });
    if (updateResult.count === 0) {
      // Someone else transitioned this request between our read and write.
      throw new AppError({ code: 'PRIVACY_REQUEST_STATE_CONFLICT' });
    }

    const updated = await tx.privacyRequest.findUniqueOrThrow({ where: { id: parsed.requestId } });

    const action =
      parsed.toStatus === 'COMPLETED'
        ? 'privacy.request.completed'
        : parsed.toStatus === 'REJECTED'
          ? 'privacy.request.rejected'
          : 'privacy.request.status_changed';

    await emitAuditEvent(
      {
        action,
        source: 'UI',
        target: { type: 'PRIVACY_REQUEST', id: updated.id },
        actor: { type: 'USER', id: actor.id },
        oldValue: { status: current.status },
        newValue: { status: updated.status },
        metadata:
          parsed.toStatus === 'REJECTED' ? { rejectionReason: parsed.rejectionReason } : undefined,
      },
      tx
    );

    return updated;
  });
}

/** Reassigns request ownership. Does not touch status/subject. */
export async function assignPrivacyRequest(input: unknown, actor: PrivacyRequestActor) {
  const parsed = assignPrivacyRequestSchema.parse(input);

  return prisma.$transaction(async tx => {
    const current = await tx.privacyRequest.findUnique({ where: { id: parsed.requestId } });
    if (!current) {
      throw new AppError({ code: 'PRIVACY_REQUEST_NOT_FOUND' });
    }

    const updated = await tx.privacyRequest.update({
      where: { id: parsed.requestId },
      data: { assignedToId: parsed.assignedToId },
    });

    await emitAuditEvent(
      {
        action: 'privacy.request.assigned',
        source: 'UI',
        target: { type: 'PRIVACY_REQUEST', id: updated.id },
        actor: { type: 'USER', id: actor.id },
        oldValue: { assignedToId: current.assignedToId },
        newValue: { assignedToId: updated.assignedToId },
      },
      tx
    );

    return updated;
  });
}

export async function getPrivacyRequest(requestId: string) {
  return prisma.privacyRequest.findUnique({
    where: { id: requestId },
    include: {
      requestedBy: { select: { id: true, name: true, email: true } },
      assignedTo: { select: { id: true, name: true, email: true } },
      exportArtifacts: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          status: true,
          createdAt: true,
          expiresAt: true,
          downloadCount: true,
          sizeBytes: true,
          checksum: true,
        },
      },
    },
  });
}

export async function listPrivacyRequests(filters?: {
  status?: PrivacyRequestStatus;
  requestType?: PrivacyRequestType;
}) {
  return prisma.privacyRequest.findMany({
    where: {
      status: filters?.status,
      requestType: filters?.requestType,
    },
    orderBy: { createdAt: 'desc' },
    include: {
      requestedBy: { select: { id: true, name: true, email: true } },
      assignedTo: { select: { id: true, name: true, email: true } },
    },
    take: 200,
  });
}
