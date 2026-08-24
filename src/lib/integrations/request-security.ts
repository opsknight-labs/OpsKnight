import { createHash } from 'crypto';
import type { NextRequest } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';

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
  rawBody: string,
  signature?: string | null,
  deliveryId?: string | null
): Promise<boolean> {
  const fingerprint = createHash('sha256')
    .update(deliveryId || signature || rawBody)
    .digest('hex');
  const result = await checkRateLimit(
    `webhook-replay:${integrationId}:${fingerprint}`,
    1,
    REPLAY_WINDOW_MS
  );
  return !result.allowed;
}
