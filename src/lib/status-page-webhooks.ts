/**
 * Webhook delivery system for status page events
 */

import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import crypto from 'crypto';
import { retry } from './retry';
import { CircuitBreakers } from './circuit-breaker';

export interface WebhookPayload {
  event: string;
  timestamp: string;
  data: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/**
 * Deliver webhook payload to a URL
 */
export async function deliverWebhook(
  url: string,
  secret: string,
  payload: WebhookPayload
): Promise<boolean> {
  try {
    // SSRF Protection: Validate webhook URL before making request
    const { validateWebhookUrl } = await import('./network-security');
    const isValidUrl = await validateWebhookUrl(url);
    if (!isValidUrl) {
      logger.warn('api.status_page.webhook.blocked_ssrf', { url });
      return false;
    }

    const payloadString = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', secret).update(payloadString).digest('hex');

    const cb = CircuitBreakers.webhook(url);

    const retryResult = await retry(
      async () => {
        const response = await cb.execute(async () => {
          const res = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Webhook-Signature': `sha256=${signature}`,
              'X-Webhook-Event': payload.event,
              'User-Agent': 'OpsKnight-StatusPage/1.0',
            },
            body: payloadString,
            signal: AbortSignal.timeout(10000), // 10 second timeout
            redirect: 'error',
          });

          if (!res.ok && (res.status >= 500 || res.status === 429)) {
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
          }

          return res;
        });

        return response;
      },
      {
        maxAttempts: 3,
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
        url,
        error:
          retryResult.error instanceof Error
            ? retryResult.error.message
            : String(retryResult.error),
      });
      return false;
    }

    const response = retryResult.data;

    if (response.ok) {
      await prisma.statusPageWebhook.updateMany({
        where: { url },
        data: { lastTriggeredAt: new Date() },
      });
      return true;
    }

    logger.warn('api.status_page.webhook.delivery_failed_status', {
      url,
      status: response.status,
      statusText: response.statusText,
    });
    return false;
  } catch (error: any) {
    logger.error('api.status_page.webhook.delivery_error', {
      url,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
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
  } catch (error: any) {
    logger.error('api.status_page.get_status_pages_for_service_error', {
      serviceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Trigger webhooks for a status page event
 */
export async function triggerStatusPageWebhooks(
  statusPageId: string,
  event: string,
  data: any // eslint-disable-line @typescript-eslint/no-explicit-any
): Promise<void> {
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
      return;
    }

    const payload: WebhookPayload = {
      event,
      timestamp: new Date().toISOString(),
      data,
    };

    // Deliver to webhooks in concurrency-controlled batches
    const BATCH_SIZE = 25;
    for (let i = 0; i < webhooks.length; i += BATCH_SIZE) {
      const batch = webhooks.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(
        batch.map(webhook =>
          deliverWebhook(webhook.url, webhook.secret, payload).catch(err => {
            logger.error('api.status_page.webhook.delivery_exception', {
              webhookId: webhook.id,
              error: err instanceof Error ? err.message : String(err),
            });
            return false;
          })
        )
      );
    }

    logger.info('api.status_page.webhooks.triggered', {
      statusPageId,
      event,
      webhookCount: webhooks.length,
    });
  } catch (error: any) {
    logger.error('api.status_page.webhooks.trigger_error', {
      statusPageId,
      event,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Trigger webhooks for all status pages associated with a service
 * This is the main entry point for triggering webhooks from incident events
 */
export async function triggerWebhooksForService(
  serviceId: string,
  event: string,
  incidentData: any // eslint-disable-line @typescript-eslint/no-explicit-any
): Promise<void> {
  try {
    // Incident visibility is security-sensitive: load it from the database
    // instead of trusting an optional caller-supplied payload field.
    if (incidentData?.id) {
      const inc = await prisma.incident.findUnique({
        where: { id: incidentData.id },
        select: { visibility: true },
      });
      if (!inc || inc.visibility !== 'PUBLIC') return;
    } else if (incidentData?.visibility !== 'PUBLIC') {
      return;
    }

    const statusPageIds = await getStatusPagesForService(serviceId);

    // No explicit mapping means no public delivery. This prevents unrelated
    // services from leaking into an arbitrary default status page.
    if (statusPageIds.length === 0) {
      return;
    }

    // Trigger webhooks for all associated status pages in parallel
    await Promise.allSettled(
      statusPageIds.map(statusPageId =>
        triggerStatusPageWebhooks(statusPageId, event, incidentData).catch(err => {
          logger.error('api.status_page.webhook.trigger_for_service_error', {
            serviceId,
            statusPageId,
            event,
            error: err instanceof Error ? err.message : String(err),
          });
        })
      )
    );
  } catch (error: any) {
    logger.error('api.status_page.webhook.trigger_for_service_fatal_error', {
      serviceId,
      event,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Verify webhook signature
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  try {
    const expectedSignature = crypto.createHmac('sha256', secret).update(payload).digest('hex');

    const providedSignature = signature.replace('sha256=', '');
    return crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(providedSignature));
  } catch {
    return false;
  }
}
