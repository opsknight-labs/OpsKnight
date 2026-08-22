import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { processEvent } from '@/lib/events';
import { transformPagerDutyToEvent } from '@/lib/integrations/pagerduty';
import { validatePayload, PagerDutyEventSchema } from '@/lib/integrations/schemas';
import { checkRateLimit, createRateLimitHeaders } from '@/lib/integrations/rate-limiter';
import { recordWebhookReceived } from '@/lib/integrations/metrics';

export async function POST(req: NextRequest) {
  const startTime = performance.now();
  let integrationId: string | null = null;

  try {
    const { searchParams } = new URL(req.url);
    const rawBody = await req.text();
    let body: any;
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
      ? await prisma.integration.findUnique({
          where: { id: paramId },
        })
      : await prisma.integration.findFirst({
          where: {
            key: providedKey || '',
            enabled: true,
          },
        });

    if (!integration || !integration.enabled) {
      return new Response(
        JSON.stringify({ status: 'error', message: 'Integration not found or disabled' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (paramId && (!providedKey || integration.key !== providedKey)) {
      return new Response(JSON.stringify({ status: 'error', message: 'Invalid integration key' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    integrationId = integration.id;

    // Rate limit
    const rateResult = await checkRateLimit(integration.id);
    if (!rateResult.allowed) {
      const headers = createRateLimitHeaders(rateResult);
      recordWebhookReceived(
        'PAGERDUTY',
        integration.id,
        false,
        performance.now() - startTime,
        'RATE_LIMITED'
      );
      return new Response(JSON.stringify({ status: 'error', message: 'Rate limit exceeded' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', ...headers },
      });
    }

    const event = transformPagerDutyToEvent(payload);
    const result = await processEvent(event, integration.serviceId, integration.id);

    recordWebhookReceived('PAGERDUTY', integration.id, true, performance.now() - startTime);

    return new Response(
      JSON.stringify({
        status: 'success',
        message: 'Event processed',
        dedup_key: event.dedup_key,
      }),
      {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    const duration = performance.now() - startTime;
    recordWebhookReceived(
      'PAGERDUTY',
      integrationId || 'unknown',
      false,
      duration,
      'INTERNAL_ERROR'
    );
    return new Response(
      JSON.stringify({
        status: 'error',
        message: error instanceof Error ? error.message : 'Internal error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
