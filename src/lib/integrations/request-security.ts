import { createHash, randomUUID } from 'crypto';
import { InboundDeliveryStatus, Prisma } from '@prisma/client';
import type { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';

export const MAX_INTEGRATION_BODY_BYTES = 1024 * 1024;
const INBOUND_DELIVERY_LEASE_MS = 5 * 60 * 1000;

export class IntegrationBodyTooLargeError extends Error {
  constructor() {
    super(`Webhook body exceeds ${MAX_INTEGRATION_BODY_BYTES} bytes`);
    this.name = 'IntegrationBodyTooLargeError';
  }
}

export async function readIntegrationBody(
  request: NextRequest,
  maxBytes = MAX_INTEGRATION_BODY_BYTES
): Promise<string> {
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new IntegrationBodyTooLargeError();
  }

  if (!request.body) return '';
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new IntegrationBodyTooLargeError();
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function deliveryHash(integrationId: string, deliveryId?: string | null): string | null {
  const nonce = deliveryId?.trim();
  if (!nonce) return null;
  const fingerprint = createHash('sha256').update(`${integrationId}\0${nonce}`).digest('hex');
  return fingerprint;
}

export type InboundDeliveryClaim =
  | { disposition: 'CLAIMED'; id: string; leaseToken: string; attempt: number }
  | { disposition: 'COMPLETED' | 'BUSY' };

/** Atomically claim a genuine provider nonce with a renewable fenced lease. */
export async function claimInboundDelivery(
  integrationId: string,
  provider: string,
  deliveryId?: string | null
): Promise<InboundDeliveryClaim | null> {
  const hash = deliveryHash(integrationId, deliveryId);
  // Payload hashes are intentionally not a substitute for provider delivery
  // IDs: identical state notifications may be legitimate future events.
  if (!hash) return null;

  const now = new Date();
  const leaseToken = randomUUID();
  const leaseExpiresAt = new Date(now.getTime() + INBOUND_DELIVERY_LEASE_MS);
  try {
    const created = await prisma.inboundDelivery.create({
      data: {
        integrationId,
        provider,
        deliveryHash: hash,
        status: InboundDeliveryStatus.PROCESSING,
        leaseToken,
        leaseExpiresAt,
      },
      select: { id: true, attempt: true },
    });
    return { disposition: 'CLAIMED', ...created, leaseToken };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      throw error;
    }
  }

  const existing = await prisma.inboundDelivery.findUnique({
    where: { integrationId_deliveryHash: { integrationId, deliveryHash: hash } },
    select: { id: true, status: true, leaseExpiresAt: true },
  });
  if (!existing || existing.status === InboundDeliveryStatus.COMPLETED) {
    return { disposition: 'COMPLETED' };
  }
  if (
    existing.status === InboundDeliveryStatus.PROCESSING &&
    existing.leaseExpiresAt &&
    existing.leaseExpiresAt > now
  ) {
    return { disposition: 'BUSY' };
  }

  const claimed = await prisma.inboundDelivery.updateMany({
    where: {
      id: existing.id,
      OR: [
        { status: InboundDeliveryStatus.FAILED },
        { status: InboundDeliveryStatus.PROCESSING, leaseExpiresAt: { lte: now } },
      ],
    },
    data: {
      status: InboundDeliveryStatus.PROCESSING,
      attempt: { increment: 1 },
      leaseToken,
      leaseExpiresAt,
      lastError: null,
    },
  });
  if (claimed.count === 0) return { disposition: 'BUSY' };
  const delivery = await prisma.inboundDelivery.findUnique({
    where: { id: existing.id },
    select: { attempt: true },
  });
  return { disposition: 'CLAIMED', id: existing.id, leaseToken, attempt: delivery?.attempt ?? 1 };
}

/** Complete only the lease held by this worker; stale workers cannot win. */
export async function completeInboundDelivery(
  claim: Extract<InboundDeliveryClaim, { disposition: 'CLAIMED' }>
): Promise<void> {
  const completed = await prisma.inboundDelivery.updateMany({
    where: { id: claim.id, status: InboundDeliveryStatus.PROCESSING, leaseToken: claim.leaseToken },
    data: { status: InboundDeliveryStatus.COMPLETED, completedAt: new Date(), leaseExpiresAt: null },
  });
  if (completed.count === 0) throw new Error('Inbound delivery lease was superseded before completion');
}

export async function failInboundDelivery(
  claim: Extract<InboundDeliveryClaim, { disposition: 'CLAIMED' }>,
  error: unknown
): Promise<void> {
  const message = error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000);
  await prisma.inboundDelivery.updateMany({
    where: { id: claim.id, status: InboundDeliveryStatus.PROCESSING, leaseToken: claim.leaseToken },
    data: { status: InboundDeliveryStatus.FAILED, leaseExpiresAt: null, lastError: message },
  });
}
