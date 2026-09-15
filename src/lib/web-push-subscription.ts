import 'server-only';

import { createHash } from 'node:crypto';
import { z } from 'zod';
import webpush from 'web-push';

import { encrypt, decrypt } from '@/lib/encryption';
import { assertSafeOutboundUrl, safeOutboundFetch } from '@/lib/network-security';

export const WebPushSubscriptionSchema = z
  .object({
    endpoint: z.string().min(1).max(4096),
    expirationTime: z.number().finite().nullable().optional(),
    keys: z
      .object({
        p256dh: z.string().min(16).max(1024),
        auth: z.string().min(8).max(1024),
      })
      .strict(),
  })
  .strict();

export type StoredWebPushSubscription = z.infer<typeof WebPushSubscriptionSchema>;

export async function normalizeWebPushSubscription(
  input: StoredWebPushSubscription
): Promise<StoredWebPushSubscription> {
  const endpoint = await assertSafeOutboundUrl(input.endpoint, { requireHttps: true });
  return {
    endpoint: endpoint.toString(),
    expirationTime: input.expirationTime ?? null,
    keys: input.keys,
  };
}

export function webPushEndpointFingerprint(endpoint: string): string {
  return createHash('sha256').update(endpoint).digest('hex');
}

export function webPushDeviceKey(endpoint: string): string {
  return `web:${webPushEndpointFingerprint(endpoint)}`;
}

/** Encrypt capability-bearing subscription data before persistence. */
export async function encodeWebPushSubscription(
  subscription: StoredWebPushSubscription
): Promise<string> {
  return encrypt(JSON.stringify(subscription));
}

/**
 * Reads the current encrypted format and the previous plaintext JSON format so
 * existing installations migrate on the next registration without losing push.
 */
export async function decodeWebPushSubscription(token: string): Promise<StoredWebPushSubscription> {
  const candidates: string[] = [];
  try {
    candidates.push(await decrypt(token));
  } catch {
    // Legacy v1 records stored JSON directly.
  }
  candidates.push(token);

  for (const candidate of candidates) {
    try {
      const parsed = WebPushSubscriptionSchema.safeParse(JSON.parse(candidate));
      if (parsed.success) return parsed.data;
    } catch {}
  }
  throw new Error('Malformed Web Push subscription');
}

export class WebPushProviderError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly retryAfter: string | null = null
  ) {
    super(message);
    this.name = 'WebPushProviderError';
  }
}

/**
 * Generates RFC Web Push request details, then sends them through OpsKnight's
 * SSRF/DNS-rebinding-safe dispatcher rather than allowing the provider library
 * to open an unconstrained outbound socket.
 */
export async function sendWebPushSafely(
  subscription: StoredWebPushSubscription,
  payload: string,
  options: Parameters<typeof webpush.generateRequestDetails>[2]
): Promise<void> {
  const safeEndpoint = await assertSafeOutboundUrl(subscription.endpoint, { requireHttps: true });
  const details = webpush.generateRequestDetails(
    { ...subscription, endpoint: safeEndpoint.toString() },
    payload,
    options
  );
  const response = await safeOutboundFetch(details.endpoint, {
    method: details.method,
    headers: details.headers,
    body: details.body as BodyInit,
    signal: AbortSignal.timeout(15_000),
  });
  if (response.ok) return;

  let providerMessage = `Web Push provider returned HTTP ${response.status}`;
  try {
    const text = (await response.text()).trim();
    if (text) providerMessage = `${providerMessage}: ${text.slice(0, 240)}`;
  } catch {}
  throw new WebPushProviderError(
    providerMessage,
    response.status,
    response.headers.get('retry-after')
  );
}
