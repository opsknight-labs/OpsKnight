import { reserveIngestionReplay } from '@/lib/ingestion/replay';
import { withIngestionDelivery, ingestionDeliveryKey } from '@/lib/ingestion/admission';
import { ingestionErrorResponse } from '@/lib/ingestion/http';
import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { processIntegrationEvent } from '@/lib/events';
import { transformPagerDutyToEvent } from '@/lib/integrations/pagerduty';
import { validatePayload, PagerDutyEventSchema } from '@/lib/integrations/schemas';
import { checkRateLimit, createRateLimitHeaders } from '@/lib/integrations/rate-limiter';
import { recordWebhookReceived } from '@/lib/integrations/metrics';
import {
  IntegrationBodyTooLargeError,
  readIntegrationBody,
} from '@/lib/integrations/request-security';
import { integrationKeyFingerprint } from '@/lib/integrations/credentials';
import { decryptStoredSecret } from '@/lib/encryption';

export async function POST(req: NextRequest) {
  const startTime = performance.now();
  let integrationId: string | null = null;

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

    const { safeCompare } = await import('@/lib/integrations/signature-verification');
    const integration = paramId
      ? await prisma.integration.findUnique({ where: { id: paramId } })
      : await prisma.integration.findFirst({
          where: {
            enabled: true,
            type: 'PAGERDUTY',
            OR: [
              { keyFingerprint: integrationKeyFingerprint(providedKey || '') },
              {
                previousKeyFingerprint: integrationKeyFingerprint(providedKey || ''),
                previousKeyExpiresAt: { gt: new Date() },
              },
              // Legacy rows keep plaintext keys until they are rotated.
              { key: providedKey || '' },
              { previousKey: providedKey || '', previousKeyExpiresAt: { gt: new Date() } },
            ],
          },
        });

    if (!integration || !integration.enabled || integration.type !== 'PAGERDUTY') {
      return new Response(
        JSON.stringify({ status: 'error', message: 'Integration not found or disabled' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const currentKey = await decryptStoredSecret(integration.key);
    const priorKey = integration.previousKey
      ? await decryptStoredSecret(integration.previousKey)
      : null;
    if (
      paramId &&
      (!providedKey ||
        !(
          safeCompare(currentKey, providedKey) ||
          (priorKey &&
            integration.previousKeyExpiresAt &&
            integration.previousKeyExpiresAt.getTime() > Date.now() &&
            safeCompare(priorKey, providedKey))
        ))
    ) {
      return new Response(JSON.stringify({ status: 'error', message: 'Invalid integration key' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    integrationId = integration.id;

    // Rate limit
    const rateResult = await checkRateLimit(integration.id);
    const replayOnly = !rateResult.allowed
      ? await reserveIngestionReplay(
          `integration:${integration.id}`,
          ingestionDeliveryKey(req.headers, 'PAGERDUTY'),
          rateResult,
          'pagerduty'
        )
      : undefined;
    if (!rateResult.allowed && !replayOnly) {
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
    const result = await withIngestionDelivery(
      ingestionDeliveryKey(req.headers, 'PAGERDUTY'),
      () =>
        processIntegrationEvent({
          event,
          serviceId: integration.serviceId,
          integrationId: integration.id,
          integrationType: 'PAGERDUTY',
          providerPayload: payload,
          receivedAt: new Date(),
        }),
      replayOnly
    );

    recordWebhookReceived('PAGERDUTY', integration.id, true, performance.now() - startTime);

    return new Response(
      JSON.stringify({
        status: 'success',
        message: result.action === 'accepted' ? 'Event accepted' : 'Event processed',
        ...('receiptId' in result ? { receiptId: result.receiptId } : {}),
        dedup_key: event.dedup_key,
      }),
      {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    const ingestionError = ingestionErrorResponse(error);
    if (ingestionError) return ingestionError;
    if (error instanceof IntegrationBodyTooLargeError) {
      return new Response(JSON.stringify({ status: 'error', message: error.message }), {
        status: 413,
        headers: { 'Content-Type': 'application/json' },
      });
    }
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
