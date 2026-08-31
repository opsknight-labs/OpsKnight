/**
 * Webhook delivery system for status page events
 */

import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import crypto from 'crypto';
import { decryptStoredSecret } from './encryption';
import { retry } from './retry';
import { CircuitBreakers } from './circuit-breaker';
import { statusWebhookDeliveryId, statusWebhookDeliveryKey } from './status-page-delivery';
import { enqueueCentralNotification } from './notification-control-plane';

export interface WebhookPayload {
  event: string;
  timestamp: string;
  data: unknown;
}

export type StatusPageWebhookDeliveryResult = {
  success: boolean;
  statusCode?: number;
  retryAfterMs?: number;
  error?: string;
};

function retryAfterMs(response: Response): number | undefined {
  const value = response.headers.get('Retry-After');
  if (!value) return undefined;
  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1_000;
  const deadline = new Date(value).getTime();
  return Number.isFinite(deadline) ? Math.max(1_000, deadline - Date.now()) : undefined;
}

function asWebhookRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { value };
}

function safeWebhookTarget(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return 'invalid-webhook-target';
  }
}

/**
 * Deliver webhook payload to a URL.
 *
 * The caller may provide a semantic delivery ID. Keeping this identifier stable
 * across durable retries lets receivers implement exactly-once effects even
 * though HTTP itself remains at-least-once.
 */
export async function deliverWebhook(
  url: string,
  secret: string,
  payload: WebhookPayload,
  deliveryId: string = crypto.randomUUID(),
  options: { maxAttempts?: number; webhookId?: string; circuitBreaker?: boolean } = {}
): Promise<StatusPageWebhookDeliveryResult> {
  try {
    // SSRF Protection: Validate webhook URL before making request
    const { assertSafeOutboundUrl, safeOutboundFetch } = await import('./network-security');
    try {
      await assertSafeOutboundUrl(url);
    } catch {
      logger.warn('api.status_page.webhook.blocked_ssrf', { target: safeWebhookTarget(url) });
      return { success: false, error: 'Invalid or restricted webhook URL' };
    }

    const payloadString = JSON.stringify(payload);
    const signatureTimestamp = Date.now().toString();
    const signature = crypto
      .createHmac('sha256', secret)
      .update(`${signatureTimestamp}.${payloadString}`)
      .digest('hex');

    const retryResult = await retry(
      async () => {
        const request = async () => {
          // Revalidate on every network attempt to defend against DNS rebinding
          // and configuration changes between retries.
          await assertSafeOutboundUrl(url);
          const res = await safeOutboundFetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Webhook-Signature': `sha256=${signature}`,
              'X-Webhook-Event': payload.event,
              'X-Webhook-Delivery': deliveryId,
              'X-Webhook-Timestamp': signatureTimestamp,
              'User-Agent': 'OpsKnight-StatusPage/1.0',
            },
            body: payloadString,
            signal: AbortSignal.timeout(10000), // 10 second timeout
          });

          if (!res.ok && (res.status >= 500 || res.status === 429)) {
            const error = new Error(`HTTP ${res.status}: ${res.statusText}`) as Error & {
              statusCode?: number;
              retryAfterMs?: number;
            };
            error.statusCode = res.status;
            error.retryAfterMs = retryAfterMs(res);
            throw error;
          }

          return res;
        };
        const response =
          options.circuitBreaker === false
            ? await request()
            : await CircuitBreakers.webhook(url).execute(request);

        return response;
      },
      {
        maxAttempts: options.maxAttempts ?? 3,
        initialDelayMs: 1000,
        retryableErrors: error => {
          if (error instanceof Error) {
            if (error.name === 'AbortError' || error.message.includes('timeout')) return true;
            if (error.message.includes('fetch') || error.message.includes('network')) return true;
            if (error.message.includes('HTTP 5') || error.message.includes('HTTP 429')) return true;
          }
          return false;
        },
      }
    );

    if (!retryResult.success || !retryResult.data) {
      logger.warn('api.status_page.webhook.delivery_failed', {
        target: safeWebhookTarget(url),
        deliveryId,
        error:
          retryResult.error instanceof Error
            ? retryResult.error.message
            : String(retryResult.error),
      });
      const error = retryResult.error as
        | (Error & { statusCode?: number; retryAfterMs?: number })
        | undefined;
      return {
        success: false,
        error: error?.message || 'Status-page webhook delivery failed',
        statusCode: error?.statusCode,
        retryAfterMs: error?.retryAfterMs,
      };
    }

    const response = retryResult.data;

    if (response.ok) {
      if (options.webhookId) {
        await prisma.statusPageWebhook.updateMany({
          where: { id: options.webhookId },
          data: { lastTriggeredAt: new Date() },
        });
      }
      return { success: true, statusCode: response.status };
    }

    logger.warn('api.status_page.webhook.delivery_failed_status', {
      target: safeWebhookTarget(url),
      deliveryId,
      status: response.status,
      statusText: response.statusText,
    });
    return {
      success: false,
      statusCode: response.status,
      retryAfterMs: retryAfterMs(response),
      error: `HTTP ${response.status}: ${response.statusText}`,
    };
  } catch (error: unknown) {
    logger.error('api.status_page.webhook.delivery_error', {
      target: safeWebhookTarget(url),
      deliveryId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Get status pages associated with a service
 */
export async function getStatusPagesForService(serviceId: string): Promise<string[]> {
  try {
    const statusPageServices = await prisma.statusPageService.findMany({
      where: {
        serviceId,
        showOnPage: true,
      },
      include: {
        statusPage: {
          select: {
            id: true,
            enabled: true,
            showIncidents: true,
          },
        },
      },
    });

    // Return only enabled status pages that show incidents
    return statusPageServices
      .filter(sps => sps.statusPage.enabled && sps.statusPage.showIncidents)
      .map(sps => sps.statusPageId);
  } catch (error: unknown) {
    logger.error('api.status_page.get_status_pages_for_service_error', {
      serviceId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Trigger webhooks for a status page event.
 *
 * Delivery completion is persisted per webhook target. If a durable parent job
 * is retried after partial success, already-completed targets are skipped and
 * only failed targets are attempted again.
 */
export async function triggerStatusPageWebhooks(
  statusPageId: string,
  event: string,
  data: unknown,
  deliveryKey?: string,
  policy: {
    incidentId?: string;
    serviceId?: string;
    expectedStatus?: string;
    escalationGeneration?: number;
  } = {}
): Promise<{ attempted: number; failed: number }> {
  try {
    const allWebhooks = await prisma.statusPageWebhook.findMany({
      where: {
        statusPageId,
        enabled: true,
      },
    });

    // Filter webhooks that subscribe to this event
    const webhooks = allWebhooks.filter(webhook => {
      const events = Array.isArray(webhook.events) ? webhook.events : [];
      return events.includes(event);
    });

    if (webhooks.length === 0) {
      return { attempted: 0, failed: 0 };
    }

    const effectiveDeliveryKey = statusWebhookDeliveryKey(
      event,
      asWebhookRecord(data),
      deliveryKey
    );
    const payload: WebhookPayload = {
      event,
      timestamp: new Date().toISOString(),
      data,
    };

    // Deliver to webhooks in concurrency-controlled batches
    const BATCH_SIZE = 25;
    let attempted = 0;
    let failed = 0;
    for (let i = 0; i < webhooks.length; i += BATCH_SIZE) {
      const batch = webhooks.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async webhook => {
          const stableDeliveryId = statusWebhookDeliveryId(effectiveDeliveryKey, webhook.id);
          await enqueueCentralNotification({
            category: 'STATUS_PAGE',
            channel: 'WEBHOOK',
            recipientType: 'WEBHOOK',
            recipientId: webhook.id,
            recipientAddress: webhook.url,
            templateKey: `status-page-webhook-${event}`,
            sourceType: 'STATUS_PAGE_WEBHOOK',
            sourceId: webhook.id,
            eventKey: effectiveDeliveryKey,
            displayMessage: `Status-page webhook: ${event}`,
            priority: 3,
            payload: {
              kind: 'STATUS_PAGE_WEBHOOK',
              url: webhook.url,
              secret: await decryptStoredSecret(webhook.secret),
              payload,
              deliveryId: stableDeliveryId,
              webhookId: webhook.id,
              statusPageId,
              incidentId: policy.incidentId,
              serviceId: policy.serviceId,
              expectedStatus: policy.expectedStatus,
              escalationGeneration: policy.escalationGeneration,
            },
          });

          return { attempted: true, success: true };
        })
      );

      attempted += results.filter(
        result => result.status === 'fulfilled' && result.value.attempted
      ).length;
      failed += results.filter(
        result =>
          result.status === 'rejected' || (result.status === 'fulfilled' && !result.value.success)
      ).length;
    }

    logger.info('api.status_page.webhooks.triggered', {
      statusPageId,
      event,
      deliveryKey: effectiveDeliveryKey,
      webhookCount: webhooks.length,
      attempted,
      failed,
    });
    return { attempted, failed };
  } catch (error: unknown) {
    logger.error('api.status_page.webhooks.trigger_error', {
      statusPageId,
      event,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Trigger webhooks for all status pages associated with a service
 * This is the main entry point for triggering webhooks from incident events
 */
export async function triggerWebhooksForService(
  serviceId: string,
  event: string,
  incidentData: unknown,
  deliveryKey?: string,
  policy: { expectedStatus?: string; escalationGeneration?: number } = {}
): Promise<{ attempted: number; failed: number; skipped?: boolean }> {
  try {
    const incidentRecord = asWebhookRecord(incidentData);
    let effectiveStatus = policy.expectedStatus;
    let effectiveGeneration = policy.escalationGeneration;

    // Incident visibility is security-sensitive: load it from the database
    // instead of trusting an optional caller-supplied payload field.
    if (typeof incidentRecord.id === 'string' && incidentRecord.id) {
      const inc = await prisma.incident.findUnique({
        where: { id: incidentRecord.id },
        select: { visibility: true, status: true, escalationGeneration: true, serviceId: true },
      });
      if (!inc || inc.visibility !== 'PUBLIC' || inc.serviceId !== serviceId)
        return { attempted: 0, failed: 0, skipped: true };
      if (policy.expectedStatus && inc.status !== policy.expectedStatus)
        return { attempted: 0, failed: 0, skipped: true };
      if (
        policy.escalationGeneration != null &&
        inc.escalationGeneration !== policy.escalationGeneration
      )
        return { attempted: 0, failed: 0, skipped: true };
      effectiveStatus = policy.expectedStatus ?? inc.status;
      effectiveGeneration = policy.escalationGeneration ?? inc.escalationGeneration;
    } else if (incidentRecord.visibility !== 'PUBLIC') {
      return { attempted: 0, failed: 0, skipped: true };
    }

    const statusPageIds = await getStatusPagesForService(serviceId);

    // No explicit mapping means no public delivery. This prevents unrelated
    // services from leaking into an arbitrary default status page.
    if (statusPageIds.length === 0) {
      return { attempted: 0, failed: 0, skipped: true };
    }

    // Trigger webhooks for all associated status pages in parallel
    const results = await Promise.allSettled(
      statusPageIds.map(statusPageId =>
        triggerStatusPageWebhooks(statusPageId, event, incidentData, deliveryKey, {
          incidentId: typeof incidentRecord.id === 'string' ? incidentRecord.id : undefined,
          serviceId,
          expectedStatus: effectiveStatus,
          escalationGeneration: effectiveGeneration,
        })
      )
    );
    return results.reduce(
      (total, result) => {
        if (result.status === 'rejected') total.failed += 1;
        else {
          total.attempted += result.value.attempted;
          total.failed += result.value.failed;
        }
        return total;
      },
      { attempted: 0, failed: 0 }
    );
  } catch (error: unknown) {
    logger.error('api.status_page.webhook.trigger_for_service_fatal_error', {
      serviceId,
      event,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Verify webhook signature
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string,
  timestamp?: string,
  maxAgeMs: number = 5 * 60_000
): boolean {
  try {
    if (timestamp) {
      const sentAt = Number(timestamp);
      if (!Number.isFinite(sentAt) || Math.abs(Date.now() - sentAt) > maxAgeMs) return false;
    }
    const signedPayload = timestamp ? `${timestamp}.${payload}` : payload;
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(signedPayload)
      .digest('hex');

    const providedSignature = signature.replace('sha256=', '');
    return crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(providedSignature));
  } catch {
    return false;
  }
}
