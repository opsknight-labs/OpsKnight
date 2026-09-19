import 'server-only';

import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { acquireRetentionResourceLock } from './resource-lock';

/**
 * Data Retention Holds Service
 *
 * Provides the single supported interface for retention hold decisions.
 * All hold operations must go through this module to ensure consistent
 * locking, validation, and audit behavior.
 */

export class RetentionHoldNotFoundError extends Error {
  readonly code = 'RESOURCE_NOT_FOUND';
  constructor(message: string) {
    super(message);
    this.name = 'RetentionHoldNotFoundError';
  }
}

export class RetentionResourceNotFoundError extends Error {
  readonly code = 'RESOURCE_NOT_FOUND';
  constructor(message: string) {
    super(message);
    this.name = 'RetentionResourceNotFoundError';
  }
}

export interface RetentionHoldInput {
  scopeType: 'USER' | 'INCIDENT' | 'PRIVACY_REQUEST';
  scopeId: string;
  reason: string;
  externalReference?: string;
  expiresAt?: Date;
}

export type DerivedHoldStatus = 'ACTIVE' | 'EXPIRED' | 'RELEASED';

export function deriveHoldStatus(
  hold: { releasedAt: Date | null; expiresAt: Date | null },
  now = new Date()
): DerivedHoldStatus {
  if (hold.releasedAt !== null) return 'RELEASED';
  if (hold.expiresAt !== null && hold.expiresAt <= now) return 'EXPIRED';
  return 'ACTIVE';
}

export interface RetentionHold {
  id: string;
  scopeType: 'USER' | 'INCIDENT' | 'PRIVACY_REQUEST';
  scopeId: string;
  reason: string;
  externalReference: string | null;
  status: DerivedHoldStatus;
  createdById: string | null;
  releasedById: string | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
  releasedAt: Date | null;
  createdBy: { id: string; name: string; email: string } | null;
  releasedBy: { id: string; name: string; email: string } | null;
}

export interface RetentionHoldListItem {
  id: string;
  scopeType: 'USER' | 'INCIDENT' | 'PRIVACY_REQUEST';
  scopeId: string;
  reason: string;
  externalReference: string | null;
  status: DerivedHoldStatus;
  createdById: string | null;
  releasedById: string | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
  releasedAt: Date | null;
  createdBy: { id: string; name: string; email: string } | null;
  releasedBy: { id: string; name: string; email: string } | null;
}

export interface HoldStatus {
  held: boolean;
  activeHoldCount: number;
  holds: RetentionHoldListItem[];
}

export interface CreateRetentionHoldResult {
  hold: RetentionHold;
}

/**
 * Checks if a resource is currently held by any active retention hold.
 * Returns the hold status with count and details.
 */
export async function isRetentionHeld(
  txOrPrisma: Prisma.TransactionClient | typeof prisma,
  scopeType: 'USER' | 'INCIDENT' | 'PRIVACY_REQUEST',
  scopeId: string
): Promise<{ held: boolean; activeHoldCount: number }> {
  if (!txOrPrisma?.dataRetentionHold?.findMany) {
    return { held: false, activeHoldCount: 0 };
  }
  const now = new Date();

  const holds = await txOrPrisma.dataRetentionHold.findMany({
    where: {
      scopeType,
      scopeId,
      releasedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { id: true },
  });

  return {
    held: holds.length > 0,
    activeHoldCount: holds.length,
  };
}

/**
 * Gets the active retention holds for a resource with full details.
 */
export async function getActiveRetentionHolds(
  txOrPrisma: Prisma.TransactionClient | typeof prisma,
  scopeType: 'USER' | 'INCIDENT' | 'PRIVACY_REQUEST',
  scopeId: string
): Promise<RetentionHoldListItem[]> {
  if (!txOrPrisma?.dataRetentionHold?.findMany) {
    return [];
  }
  const now = new Date();

  const holds = await txOrPrisma.dataRetentionHold.findMany({
    where: {
      scopeType,
      scopeId,
      releasedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    include: {
      createdBy: { select: { id: true, name: true, email: true } },
      releasedBy: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return holds.map(hold => ({
    ...hold,
    status: deriveHoldStatus(hold, now),
  }));
}

/**
 * Gets a single retention hold by ID with full details.
 */
export async function getRetentionHold(
  txOrPrisma: Prisma.TransactionClient | typeof prisma,
  holdId: string
): Promise<RetentionHold | null> {
  const hold = await txOrPrisma.dataRetentionHold.findUnique({
    where: { id: holdId },
    include: {
      createdBy: { select: { id: true, name: true, email: true } },
      releasedBy: { select: { id: true, name: true, email: true } },
    },
  });
  if (!hold) return null;
  return {
    ...hold,
    status: deriveHoldStatus(hold),
  };
}

/**
 * Lists retention holds with filtering and pagination.
 */
export interface ListRetentionHoldsOptions {
  scopeType?: 'USER' | 'INCIDENT' | 'PRIVACY_REQUEST';
  scopeId?: string;
  status?: 'ACTIVE' | 'EXPIRED' | 'RELEASED' | 'ALL';
  cursor?: string;
  limit?: number;
}

export interface PaginatedRetentionHolds {
  holds: RetentionHoldListItem[];
  nextCursor: string | null;
}

export async function listRetentionHolds(
  txOrPrisma: Prisma.TransactionClient | typeof prisma,
  options: ListRetentionHoldsOptions = {}
): Promise<PaginatedRetentionHolds> {
  const { scopeType, scopeId, status = 'ACTIVE', cursor, limit = 50 } = options;
  const now = new Date();

  const where: Prisma.DataRetentionHoldWhereInput = {};

  if (scopeType) where.scopeType = scopeType;
  if (scopeId) where.scopeId = scopeId;

  if (status === 'ACTIVE') {
    where.releasedAt = null;
    where.OR = [{ expiresAt: null }, { expiresAt: { gt: now } }];
  } else if (status === 'EXPIRED') {
    where.releasedAt = null;
    where.expiresAt = { lte: now };
  } else if (status === 'RELEASED') {
    where.releasedAt = { not: null };
  }
  // 'ALL' applies no status filter

  const holds = await txOrPrisma.dataRetentionHold.findMany({
    where,
    include: {
      createdBy: { select: { id: true, name: true, email: true } },
      releasedBy: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
  });

  let nextCursor: string | null = null;
  if (holds.length > limit) {
    holds.pop();
    nextCursor = holds[holds.length - 1]?.id ?? null;
  }

  return {
    holds: holds.map(h => ({
      ...h,
      status: deriveHoldStatus(h, now),
    })),
    nextCursor,
  };
}

/**
 * Validates that a target resource exists before creating a hold.
 */
async function validateResourceExists(
  tx: Prisma.TransactionClient,
  scopeType: 'USER' | 'INCIDENT' | 'PRIVACY_REQUEST',
  scopeId: string
): Promise<boolean> {
  switch (scopeType) {
    case 'USER':
      return !!(await tx.user.findUnique({ where: { id: scopeId }, select: { id: true } }));
    case 'INCIDENT':
      return !!(await tx.incident.findUnique({ where: { id: scopeId }, select: { id: true } }));
    case 'PRIVACY_REQUEST':
      return !!(await tx.privacyRequest.findUnique({
        where: { id: scopeId },
        select: { id: true },
      }));
  }
}

/**
 * Creates a new retention hold.
 * Acquires resource lock to prevent race with cleanup/deletion.
 */
export async function createRetentionHold(
  input: RetentionHoldInput,
  actorId: string,
  tx?: Prisma.TransactionClient
): Promise<CreateRetentionHoldResult> {
  const execute = async (txClient: Prisma.TransactionClient) => {
    // Acquire resource lock to prevent race with cleanup/deletion
    await acquireRetentionResourceLock(txClient, input.scopeType, input.scopeId);

    // Re-validate resource still exists after acquiring lock
    const exists = await validateResourceExists(txClient, input.scopeType, input.scopeId);
    if (!exists) {
      throw new RetentionResourceNotFoundError(
        `Resource ${input.scopeType}:${input.scopeId} not found`
      );
    }

    // Validate expiresAt is in the future if provided
    if (input.expiresAt && input.expiresAt <= new Date()) {
      throw new Error('expiresAt must be in the future');
    }

    // Validate reason is not empty
    if (!input.reason || input.reason.trim().length === 0) {
      throw new Error('reason is required');
    }

    const hold = await txClient.dataRetentionHold.create({
      data: {
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        reason: input.reason.trim(),
        externalReference: input.externalReference?.trim() || null,
        createdById: actorId,
        expiresAt: input.expiresAt || null,
      },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
        releasedBy: { select: { id: true, name: true, email: true } },
      },
    });

    // Audit log
    const { emitAuditEvent } = await import('@/lib/audit');
    await emitAuditEvent(
      {
        action: 'retention.hold.created',
        source: 'UI',
        target: { type: 'DATA_RETENTION_HOLD', id: hold.id },
        actor: { type: 'USER', id: actorId },
        metadata: {
          scopeType: input.scopeType,
          scopeId: input.scopeId,
          reasonProvided: true,
          externalReferenceProvided: Boolean(input.externalReference),
        },
      },
      txClient
    );

    return {
      hold: {
        ...hold,
        status: deriveHoldStatus(hold),
      },
    };
  };

  return tx ? execute(tx) : prisma.$transaction(execute);
}

/**
 * Releases an existing retention hold.
 * Idempotent: releasing an already-released hold is a no-op.
 */
export async function releaseRetentionHold(
  holdId: string,
  actorId: string,
  tx?: Prisma.TransactionClient
): Promise<{ hold: RetentionHold; wasAlreadyReleased: boolean }> {
  const execute = async (txClient: Prisma.TransactionClient) => {
    const initialHold = await txClient.dataRetentionHold.findUnique({
      where: { id: holdId },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
        releasedBy: { select: { id: true, name: true, email: true } },
      },
    });

    if (!initialHold) {
      throw new RetentionHoldNotFoundError(`Retention hold ${holdId} not found`);
    }

    // Acquire resource lock to prevent race with cleanup
    await acquireRetentionResourceLock(txClient, initialHold.scopeType, initialHold.scopeId);

    // Re-read hold AFTER acquiring resource lock to prevent concurrent release race
    const existingHold = await txClient.dataRetentionHold.findUnique({
      where: { id: holdId },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
        releasedBy: { select: { id: true, name: true, email: true } },
      },
    });

    if (!existingHold) {
      throw new RetentionHoldNotFoundError(`Retention hold ${holdId} not found`);
    }

    if (existingHold.releasedAt) {
      // Already released - idempotent no-op without mutation or duplicate audit
      return {
        hold: {
          ...existingHold,
          status: deriveHoldStatus(existingHold),
        },
        wasAlreadyReleased: true,
      };
    }

    const hold = await txClient.dataRetentionHold.update({
      where: { id: holdId },
      data: {
        releasedAt: new Date(),
        releasedById: actorId,
      },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
        releasedBy: { select: { id: true, name: true, email: true } },
      },
    });

    // Audit log
    const { emitAuditEvent } = await import('@/lib/audit');
    await emitAuditEvent(
      {
        action: 'retention.hold.released',
        source: 'UI',
        target: { type: 'DATA_RETENTION_HOLD', id: hold.id },
        actor: { type: 'USER', id: actorId },
        metadata: {
          scopeType: hold.scopeType,
          scopeId: hold.scopeId,
          wasAlreadyReleased: false,
        },
      },
      txClient
    );

    return {
      hold: {
        ...hold,
        status: deriveHoldStatus(hold),
      },
      wasAlreadyReleased: false,
    };
  };

  return tx ? execute(tx) : prisma.$transaction(execute);
}

/**
 * Asserts that a resource is not held, throwing if it is.
 * Used by destructive operations to enforce hold protection.
 */
export async function assertResourceNotHeld(
  txOrPrisma: Prisma.TransactionClient | typeof prisma,
  scopeType: 'USER' | 'INCIDENT' | 'PRIVACY_REQUEST',
  scopeId: string
): Promise<void> {
  const { held, activeHoldCount } = await isRetentionHeld(txOrPrisma, scopeType, scopeId);
  if (held) {
    const error = new Error(
      `Resource ${scopeType}:${scopeId} is protected by ${activeHoldCount} active retention hold(s)`
    ) as Error & {
      code: string;
      details: { scopeType: string; scopeId: string; activeHoldCount: number };
    };
    error.code = 'RETENTION_HOLD_BLOCKED';
    error.details = { scopeType, scopeId, activeHoldCount };
    throw error;
  }
}
