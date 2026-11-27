import { randomBytes } from 'node:crypto';
import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { jsonError, jsonOk } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { encrypt, decryptStoredSecret } from '@/lib/encryption';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { assertSafeOutboundUrl, safeOutboundFetch } from '@/lib/network-security';
import { getOpenStatusSnapshot } from './public-access';
import {
  signWebhookPayload,
  verifyWebhookUnsubscribeToken,
  webhookUnsubscribeUrl,
} from './subscriber-webhook-crypto';

/** Default events a subscriber webhook receives (same vocabulary as admin status webhooks). */
export const SUBSCRIBER_WEBHOOK_EVENTS = [
  'incident.created',
  'incident.acknowledged',
  'incident.updated',
  'incident.resolved',
];
const MAX_URL_LENGTH = 2048;
const MAX_SUBSCRIBER_WEBHOOKS_PER_PAGE = 500;
const CHALLENGE_TIMEOUT_MS = 5_000;

/** HTTPS only, no credentials, and the resolved address must be public (SSRF guard). */
export async function validateSubscriberWebhookUrl(
  raw: string
): Promise<{ ok: true; url: URL } | { ok: false; reason: string }> {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_URL_LENGTH)
    return { ok: false, reason: 'Enter a valid HTTPS URL.' };
  try {
    const url = await assertSafeOutboundUrl(raw.trim(), { requireHttps: true });
    url.hash = '';
    return { ok: true, url };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    return {
      ok: false,
      reason: /HTTPS/.test(message)
        ? 'The URL must use https.'
        : /restricted|credentials/.test(message)
          ? 'That address is not allowed.'
          : 'Enter a valid HTTPS URL.',
    };
  }
}

/**
 * Challenge handshake: POST a signed `subscription.verification` event; the endpoint proves
 * control by echoing the challenge (JSON `{"challenge": "..."}` or the bare token) in a 2xx reply.
 */
export async function runWebhookChallenge(url: string, secret: string): Promise<boolean> {
  const challenge = randomBytes(24).toString('hex');
  const timestamp = Date.now().toString();
  const body = JSON.stringify({
    event: 'subscription.verification',
    timestamp: new Date().toISOString(),
    data: { challenge },
  });
  try {
    const response = await safeOutboundFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signWebhookPayload(secret, timestamp, body),
        'X-Webhook-Event': 'subscription.verification',
        'X-Webhook-Timestamp': timestamp,
        'User-Agent': 'OpsKnight-StatusPage/1.0',
      },
      body,
      signal: AbortSignal.timeout(CHALLENGE_TIMEOUT_MS),
    });
    if (!response.ok) return false;
    const text = (await response.text()).slice(0, 2048).trim();
    if (text === challenge) return true;
    try {
      return (JSON.parse(text) as { challenge?: unknown }).challenge === challenge;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

/** POST /api/status/[slug]/subscribe/webhook  { url } */
export async function subscribeWebhookRequest(req: NextRequest, slug: string) {
  try {
    const ip = getClientIp(req.headers);
    const ipRate = await checkRateLimit(`api:status:subscribe-webhook:ip:${ip}`, 5, 60_000);
    if (!ipRate.allowed) return jsonError('Too many requests. Try again shortly.', 429);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return jsonError('Invalid JSON', 400);
    }
    const rawUrl = (body as { url?: unknown } | null)?.url;
    if (typeof rawUrl !== 'string') return jsonError('A webhook URL is required.', 400);

    const snapshot = await getOpenStatusSnapshot(slug);
    if (
      !snapshot ||
      !snapshot.page.showSubscribe ||
      (snapshot.page.subscription?.channels &&
        !snapshot.page.subscription.channels.includes('WEBHOOK'))
    )
      return jsonError('Not found', 404);
    const pageId = snapshot.page.id;

    const checked = await validateSubscriberWebhookUrl(rawUrl);
    if (!checked.ok) return jsonError(checked.reason, 400);
    const url = checked.url.toString();

    const urlRate = await checkRateLimit(
      `api:status:subscribe-webhook:url:${pageId}:${checked.url.host}`,
      3,
      60_000
    );
    if (!urlRate.allowed) return jsonError('Too many requests. Try again shortly.', 429);

    const [existing, total] = await Promise.all([
      prisma.statusPageWebhook.findFirst({
        where: { statusPageId: pageId, url, source: 'SUBSCRIBER' },
        select: { id: true },
      }),
      prisma.statusPageWebhook.count({ where: { statusPageId: pageId, source: 'SUBSCRIBER' } }),
    ]);
    // Same answer as success-without-secret so the form cannot probe for existing endpoints.
    if (existing) return jsonOk({ subscribed: true, alreadySubscribed: true }, 200);
    if (total >= MAX_SUBSCRIBER_WEBHOOKS_PER_PAGE)
      return jsonError('This page cannot accept more webhook subscribers.', 429);

    const secret = randomBytes(32).toString('hex');
    if (!(await runWebhookChallenge(url, secret))) {
      return jsonError(
        'Your endpoint did not echo the verification challenge. Return the "challenge" value from the request body.',
        400
      );
    }
    const webhook = await prisma.statusPageWebhook.create({
      data: {
        statusPageId: pageId,
        url,
        secret: await encrypt(secret),
        events: SUBSCRIBER_WEBHOOK_EVENTS,
        enabled: true,
        source: 'SUBSCRIBER',
        verifiedAt: new Date(),
      },
      select: { id: true },
    });
    logger.info('api.status.subscribe_webhook.activated', { pageId, webhookId: webhook.id });
    return jsonOk(
      {
        subscribed: true,
        // Shown once: needed to verify the X-Webhook-Signature header on deliveries.
        secret,
        unsubscribeUrl: webhookUnsubscribeUrl(secret, webhook.id),
      },
      201
    );
  } catch (error) {
    logger.error('api.status.subscribe_webhook.error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError('Failed to subscribe', 500);
  }
}

/** GET|POST /api/status/subscriptions/webhook-unsubscribe?id=&token= */
export async function unsubscribeWebhookRequest(id: string | null, token: string | null) {
  if (!id || !token || id.length > 100 || token.length > 200) return jsonError('Invalid link', 400);
  const webhook = await prisma.statusPageWebhook.findFirst({
    where: { id, source: 'SUBSCRIBER' },
    select: { id: true, secret: true },
  });
  const secret = webhook ? await decryptStoredSecret(webhook.secret).catch(() => null) : null;
  if (!webhook || !secret || !verifyWebhookUnsubscribeToken(secret, webhook.id, token))
    return jsonError('Invalid link', 400);
  await prisma.statusPageWebhook.deleteMany({ where: { id: webhook.id, source: 'SUBSCRIBER' } });
  return jsonOk({ unsubscribed: true }, 200);
}
