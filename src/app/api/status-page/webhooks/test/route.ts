import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { assertAdmin } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { deliverWebhook } from '@/lib/status-page-webhooks';
import { decryptStoredSecret } from '@/lib/encryption';

/**
 * Test webhook endpoint
 * POST /api/status-page/webhooks/test
 * Sends a test payload to webhooks for a status page
 */
export async function POST(req: NextRequest) {
  try {
    await assertAdmin();
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unauthorized', 403);
  }

  try {
    const body = await req.json();
    const { statusPageId, webhookId } = body;

    if (!statusPageId) {
      return jsonError('statusPageId is required', 400);
    }

    // Get webhook if specific webhookId provided, otherwise test all webhooks for status page
    const webhooks = webhookId
      ? [await prisma.statusPageWebhook.findUnique({ where: { id: webhookId } })]
      : await prisma.statusPageWebhook.findMany({
          where: { statusPageId, enabled: true },
        });

    const validWebhooks = webhooks.filter(w => w !== null);

    if (validWebhooks.length === 0) {
      return jsonError(
        webhookId ? 'Webhook not found' : 'No enabled webhooks found for this status page',
        404
      );
    }

    // Send test payload to all webhooks
    const testPayload = {
      id: 'test-incident-id',
      title: 'Test Incident',
      description: 'This is a test webhook payload',
      status: 'OPEN',
      urgency: 'HIGH',
      priority: 'P1',
      service: {
        id: 'test-service-id',
        name: 'Test Service',
      },
      assignee: null,
      createdAt: new Date().toISOString(),
    };

    const results = await Promise.allSettled(
      validWebhooks.map(async webhook => {
        const payload = {
          event: 'incident.created',
          timestamp: new Date().toISOString(),
          data: testPayload,
        };
        const ok = await deliverWebhook(
          webhook!.url,
          await decryptStoredSecret(webhook!.secret),
          payload
        );
        if (!ok) throw new Error(`Failed delivery to ${webhook!.url}`);
        return { webhookId: webhook!.id, url: webhook!.url, success: true };
      })
    );

    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    logger.info('api.status_page.webhook.test_sent', {
      statusPageId,
      webhookCount: validWebhooks.length,
      successful,
      failed,
    });

    return jsonOk(
      {
        success: true,
        message: `Test payload sent to ${successful} webhook(s)`,
        results: {
          total: validWebhooks.length,
          successful,
          failed,
        },
      },
      200
    );
  } catch (error: any) {
    logger.error('api.status_page.webhook.test_error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError('Failed to test webhook', 500);
  }
}
