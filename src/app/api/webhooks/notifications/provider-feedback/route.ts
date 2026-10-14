import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  IntegrationBodyTooLargeError,
  readIntegrationBody,
} from '@/lib/integrations/request-security';
import { jsonError, jsonOk } from '@/lib/api-response';
import { ingestNotificationProviderFeedback } from '@/lib/notification-provider-feedback';

const feedbackSchema = z
  .object({
    provider: z.string().trim().min(1).max(80),
    providerEventId: z.string().trim().min(1).max(191),
    providerMessageId: z.string().trim().min(1).max(191).optional(),
    type: z.enum([
      'DELIVERED',
      'HARD_BOUNCE',
      'SOFT_BOUNCE',
      'COMPLAINT',
      'SUPPRESSION',
      'INVALID_RECIPIENT',
    ]),
    occurredAt: z.string().datetime({ offset: true }),
  })
  .strict();

function validSignature(body: string, supplied: string | null, secret: string) {
  if (!supplied || !/^(sha256=)?[a-fA-F0-9]{64}$/.test(supplied)) return false;
  const expected = createHmac('sha256', secret).update(body).digest('hex');
  const actualBuffer = Buffer.from(supplied.replace(/^sha256=/, ''), 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

export async function POST(request: NextRequest) {
  const secret = process.env.NOTIFICATION_PROVIDER_FEEDBACK_SECRET?.trim();
  if (!secret) return jsonError('Provider feedback is not configured.', 503);
  const signature = request.headers.get('x-opsknight-signature');
  if (!signature || signature.length > 71 || !/^(sha256=)?[a-fA-F0-9]{64}$/.test(signature))
    return jsonError('Invalid provider feedback signature.', 401);
  let body: string;
  try {
    body = await readIntegrationBody(request, 64 * 1024);
  } catch (error) {
    if (error instanceof IntegrationBodyTooLargeError)
      return jsonError('Provider feedback body too large.', 413);
    throw error;
  }
  if (!validSignature(body, request.headers.get('x-opsknight-signature'), secret)) {
    return jsonError('Invalid provider feedback signature.', 401);
  }
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return jsonError('Invalid JSON.', 400);
  }
  const parsed = feedbackSchema.safeParse(value);
  if (!parsed.success) return jsonError('Invalid provider feedback event.', 400);
  const result = await ingestNotificationProviderFeedback({
    ...parsed.data,
    occurredAt: new Date(parsed.data.occurredAt),
  });
  return jsonOk(result, 202);
}
