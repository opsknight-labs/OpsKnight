import { createHash } from 'crypto';
import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { processEvent } from '@/lib/events';
import { transformPagerDutyToEvent } from '@/lib/integrations/pagerduty';
import { validatePayload, PagerDutyEventSchema } from '@/lib/integrations/schemas';
import { checkRateLimit, createRateLimitHeaders } from '@/lib/integrations/rate-limiter';
import { recordWebhookReceived } from '@/lib/integrations/metrics';
import {
  IntegrationBodyTooLargeError,
  claimWebhookDelivery,
  completeWebhookDelivery,
  failWebhookDelivery,
  readIntegrationBody,
  webhookDeliveryResponse,
  type WebhookDeliveryClaim,
} from '@/lib/integrations/request-security';

export async function POST(req: NextRequest) {
  const startTime = performance.now();
  let integrationId: string | null = null;
  let deliveryClaim: WebhookDeliveryClaim = { tracked: false };

  try {
    const { searchParams } = new URL(req.url);
    const rawBody = await readIntegrationBody(req);
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return new Response(JSON.stringify({ status: 'error', message: 'Invalid JSON payload' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const validation = validatePayload(PagerDutyEventSchema, body);
    if (!validation.success) {
      return new Response(
        JSON.stringify({
          status: 'invalid event',
          message: 'Event object is invalid',
          errors: validation.errors.map(
            (e: { path: string; message: string }) => `'${e.path}' ${e.message}`
          ),
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const payload = validation.data;
    const paramId = searchParams.get('integrationId');
    const providedKey =
      searchParams.get('key') ||
      searchParams.get('token') ||
      payload.routing_key ||
      payload.routingKey ||
      req.headers.get('x-routing-key') ||
      req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');

    if (!paramId && !providedKey) {
      return new Response(
        JSON.stringify({ status: 'error', message: 'routing_key or integration key is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const integration = paramId
      ? await prisma.integration.findUnique({ where: { id: paramId } })
      : await prisma.integration.findFirst({
          where: { key: providedKey || '', enabled: true, type: 'PAGERDUTY' },
        });

    if (!integration || !integration.enabled) {
      return new Response(
        JSON.stringify({ status: 'error', message: 'Integration not found or disabled' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // A routing key is scoped to its configured provider. Do not let a key for
    // another integration type enter PagerDuty's parser/domain adapter.
    if (integration.type !== 'PAGERDUTY') {
      return new Response(JSON.stringify({ status: 'error', message: 'Invalid integration key' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { safeCompare } = await import('@/lib/integrations/signature-verification');
    if (paramId && (!providedKey || !safeCompare(integration.key, providedKey))) {
      return new Response(JSON.stringify({ status: 'error', message: 'Invalid integration key' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    integrationId = integration.id;
    const rateResult = await checkRateLimit(integration.id);
    if (!rateResult.allowed) {
      recordWebhookReceived(
        'PAGERDUTY',
        integration.id,
        false,
        performance.now() - startTime,
        'RATE_LIMITED'
      );
      return new Response(JSON.stringify({ status: 'error', message: 'Rate limit exceeded' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', ...createRateLimitHeaders(rateResult) },
      });
    }

    // Events API v2 payloads do not always carry a delivery UUID. Prefer one
    // when present, otherwise derive a stable composite from the action,
    // deduplication key and exact signed/received body. This identifies a retry
    // without collapsing a later, materially different lifecycle event.
    const explicitDeliveryId = req.headers.get('x-request-id') || req.headers.get('x-pagerduty-delivery');
    const dedupKey = typeof payload.dedup_key === 'string' ? payload.dedup_key : '';
    const action = typeof payload.event_action === 'string' ? payload.event_action : 'event';
    const compositeDeliveryId = dedupKey
      ? `${action}:${dedupKey}:${createHash('sha256').update(rawBody).digest('hex')}`
      : null;
    deliveryClaim = await claimWebhookDelivery(
      integration.id,
      'pagerduty',
      explicitDeliveryId || compositeDeliveryId
    );
    const claimedResponse = webhookDeliveryResponse(deliveryClaim);
    if (claimedResponse) return claimedResponse;

    const event = transformPagerDutyToEvent(payload);
    const result = await processEvent(event, integration.serviceId, integration.id);
    await completeWebhookDelivery(deliveryClaim);

    recordWebhookReceived('PAGERDUTY', integration.id, true, performance.now() - startTime);
    return new Response(
      JSON.stringify({ status: 'success', message: 'Event processed', dedup_key: event.dedup_key, result }),
      { status: 202, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    await failWebhookDelivery(deliveryClaim, error).catch(() => {});
    if (error instanceof IntegrationBodyTooLargeError) {
      return new Response(JSON.stringify({ status: 'error', message: error.message }), {
        status: 413,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    recordWebhookReceived(
      'PAGERDUTY',
      integrationId || 'unknown',
      false,
      performance.now() - startTime,
      'INTERNAL_ERROR'
    );
    return new Response(
      JSON.stringify({ status: 'error', message: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
