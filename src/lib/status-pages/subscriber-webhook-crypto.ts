import { createHmac, timingSafeEqual } from 'node:crypto';
import { getBaseUrl } from '@/lib/env-validation';

/** Same scheme as admin webhook deliveries: sha256=HMAC(secret, `${timestamp}.${body}`). */
export function signWebhookPayload(secret: string, timestamp: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

export function verifyWebhookSignature(
  secret: string,
  timestamp: string,
  body: string,
  signature: string
): boolean {
  const expected = Buffer.from(signWebhookPayload(secret, timestamp, body));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Derived from the secret the subscriber already holds, so no extra token is stored. */
export function webhookUnsubscribeToken(secret: string, webhookId: string): string {
  return createHmac('sha256', secret).update(`unsubscribe:${webhookId}`).digest('hex');
}

export function verifyWebhookUnsubscribeToken(secret: string, webhookId: string, token: string) {
  const expected = Buffer.from(webhookUnsubscribeToken(secret, webhookId));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function webhookUnsubscribeUrl(secret: string, webhookId: string): string {
  const token = webhookUnsubscribeToken(secret, webhookId);
  return `${getBaseUrl()}/api/status/subscriptions/webhook-unsubscribe?id=${encodeURIComponent(webhookId)}&token=${token}`;
}
