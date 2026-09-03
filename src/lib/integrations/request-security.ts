import { createHash } from 'crypto';
import type { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';

export const MAX_INTEGRATION_BODY_BYTES = 1024 * 1024;
const WEBHOOK_DELIVERY_TASK = 'INBOUND_INTEGRATION_DELIVERY';
const WEBHOOK_DELIVERY_LEASE_MS = 5 * 60 * 1000;
const MAX_RECORDED_ERROR_LENGTH = 1000;

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

export type WebhookDeliveryClaim =
  | { tracked: false }
  | {
      tracked: true;
      id: string;
      state: 'ACQUIRED' | 'SUCCEEDED' | 'IN_PROGRESS';
    };

function deliveryRecordId(integrationId: string, provider: string, deliveryId: string): string {
  const fingerprint = createHash('sha256')
    .update(`${provider}\0${integrationId}\0${deliveryId}`)
    .digest('hex');
  return `inbound-delivery:${fingerprint}`;
}

/**
 * Claim a provider delivery before business processing.
 *
 * Unlike the old replay tombstone, this is a durable inbox lease:
 * - COMPLETED means the delivery already committed successfully and is a safe no-op.
 * - PROCESSING with a live lease means another replica owns it.
 * - FAILED or an expired PROCESSING lease can be reclaimed by a provider retry.
 *
 * The provider nonce is hashed before persistence so request identifiers that may
 * contain sensitive provider metadata are never stored verbatim.
 */
export async function claimWebhookDelivery(
  integrationId: string,
  provider: string,
  deliveryId?: string | null
): Promise<WebhookDeliveryClaim> {
  const nonce = deliveryId?.trim();
  if (!nonce) return { tracked: false };

  const id = deliveryRecordId(integrationId, provider, nonce);
  const now = new Date();
  const leaseExpiredBefore = new Date(now.getTime() - WEBHOOK_DELIVERY_LEASE_MS);
  const deliveryHash = createHash('sha256').update(nonce).digest('hex');

  try {
    await prisma.backgroundJob.create({
      data: {
        id,
        type: 'SCHEDULED_TASK',
        status: 'PROCESSING',
        scheduledAt: now,
        startedAt: now,
        attempts: 1,
        // Provider retries, not the generic worker, own retry cadence for inbox rows.
        maxAttempts: 1000,
        payload: {
          task: WEBHOOK_DELIVERY_TASK,
          integrationId,
          provider,
          deliveryHash,
        },
      },
    });
    return { tracked: true, id, state: 'ACQUIRED' };
  } catch {
    const existing = await prisma.backgroundJob.findUnique({
      where: { id },
      select: { status: true },
    });

    if (existing?.status === 'COMPLETED') {
      return { tracked: true, id, state: 'SUCCEEDED' };
    }

    const reclaimed = await prisma.backgroundJob.updateMany({
      where: {
        id,
        OR: [
          { status: 'FAILED' },
          { status: 'PROCESSING', startedAt: { lte: leaseExpiredBefore } },
        ],
      },
      data: {
        status: 'PROCESSING',
        startedAt: now,
        completedAt: null,
        failedAt: null,
        error: null,
        attempts: { increment: 1 },
      },
    });

    if (reclaimed.count === 1) {
      return { tracked: true, id, state: 'ACQUIRED' };
    }

    // Re-read after the conditional update so a concurrent owner that completed
    // between our first read and reclaim attempt is recognized as a success.
    const current = await prisma.backgroundJob.findUnique({
      where: { id },
      select: { status: true },
    });
    if (current?.status === 'COMPLETED') {
      return { tracked: true, id, state: 'SUCCEEDED' };
    }

    return { tracked: true, id, state: 'IN_PROGRESS' };
  }
}

export async function completeWebhookDelivery(claim: WebhookDeliveryClaim): Promise<void> {
  if (!claim.tracked || claim.state !== 'ACQUIRED') return;
  await prisma.backgroundJob.updateMany({
    where: { id: claim.id, status: 'PROCESSING' },
    data: {
      status: 'COMPLETED',
      completedAt: new Date(),
      failedAt: null,
      error: null,
    },
  });
}

export async function failWebhookDelivery(
  claim: WebhookDeliveryClaim,
  error: unknown
): Promise<void> {
  if (!claim.tracked || claim.state !== 'ACQUIRED') return;
  const message = (error instanceof Error ? error.message : String(error)).slice(
    0,
    MAX_RECORDED_ERROR_LENGTH
  );
  await prisma.backgroundJob.updateMany({
    where: { id: claim.id, status: 'PROCESSING' },
    data: {
      status: 'FAILED',
      failedAt: new Date(),
      completedAt: null,
      error: message || 'Inbound integration processing failed',
    },
  });
}

export function webhookDeliveryResponse(claim: WebhookDeliveryClaim): Response | null {
  if (!claim.tracked || claim.state === 'ACQUIRED') return null;
  if (claim.state === 'SUCCEEDED') {
    return new Response(JSON.stringify({ status: 'duplicate', processed: true }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(JSON.stringify({ status: 'processing', retry: true }), {
    status: 503,
    headers: { 'Content-Type': 'application/json', 'Retry-After': '1' },
  });
}
