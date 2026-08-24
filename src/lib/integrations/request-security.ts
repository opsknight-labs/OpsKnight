import { createHash } from 'crypto';
import type { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';

export const MAX_INTEGRATION_BODY_BYTES = 1024 * 1024;
const REPLAY_WINDOW_MS = 24 * 60 * 60 * 1000;

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

export async function rejectWebhookReplay(
  integrationId: string,
  deliveryId?: string | null
): Promise<boolean> {
  // A body/signature is not a delivery nonce: providers legitimately resend
  // identical state notifications. Only claim an explicit provider delivery
  // ID (or a signed timestamp+signature tuple supplied by the caller).
  const nonce = deliveryId?.trim();
  if (!nonce) return false;
  const fingerprint = createHash('sha256').update(`${integrationId}\0${nonce}`).digest('hex');
  const key = `webhook-replay:${fingerprint}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + REPLAY_WINDOW_MS);
  try {
    await prisma.rateLimit.create({ data: { key, count: 1, expiresAt } });
    return false;
  } catch {
    // Reclaim an expired nonce atomically. If no expired row was reclaimed,
    // another request owns an unexpired claim and this delivery is a replay.
    const reclaimed = await prisma.rateLimit.updateMany({
      where: { key, expiresAt: { lte: now } },
      data: { count: 1, expiresAt },
    });
    return reclaimed.count === 0;
  }
}
