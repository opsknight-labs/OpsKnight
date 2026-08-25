import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { assertAdmin } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { randomBytes } from 'crypto';
import { assertSafeOutboundUrl } from '@/lib/network-security';
import { encrypt } from '@/lib/encryption';

/**
 * Webhook Management API
 * GET /api/status-page/webhooks - List webhooks
 * POST /api/status-page/webhooks - Create webhook
 */

export async function GET(req: NextRequest) {
  try {
    await assertAdmin();
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unauthorized', 403);
  }

  try {
    const { searchParams } = new URL(req.url);
    const statusPageId = searchParams.get('statusPageId');

    if (!statusPageId) {
      return jsonError('statusPageId is required', 400);
    }

    const webhooks = await prisma.statusPageWebhook.findMany({
      where: { statusPageId },
      orderBy: { createdAt: 'desc' },
    });

    return jsonOk(
      {
        webhooks: webhooks.map(webhook => ({ ...webhook, secret: '••••••••', hasSecret: true })),
      },
      200
    );
  } catch (error: any) {
    logger.error('api.status_page.webhooks.get_error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError('Failed to fetch webhooks', 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    await assertAdmin();
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unauthorized', 403);
  }

  try {
    const body = await req.json();
    const { statusPageId, url, events } = body;

    if (!statusPageId || !url || !events || !Array.isArray(events)) {
      return jsonError('statusPageId, url, and events array are required', 400);
    }

    // Validate URL
    try {
      await assertSafeOutboundUrl(url);
    } catch {
      return jsonError('Invalid URL format', 400);
    }

    // Generate secret
    const secret = randomBytes(32).toString('hex');

    const webhook = await prisma.statusPageWebhook.create({
      data: {
        statusPageId,
        url,
        secret: await encrypt(secret),
        events: events,
        enabled: true,
      },
    });

    logger.info('api.status_page.webhook.created', { webhookId: webhook.id, statusPageId });
    return jsonOk({ webhook: { ...webhook, secret }, hasSecret: true }, 201);
  } catch (error: any) {
    logger.error('api.status_page.webhook.create_error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError('Failed to create webhook', 500);
  }
}

/**
 * PATCH /api/status-page/webhooks?id=xxx
 * Update webhook (URL, events, enabled status)
 */
export async function PATCH(req: NextRequest) {
  try {
    await assertAdmin();
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unauthorized', 403);
  }

  try {
    const body = await req.json();
    const { id, url, events, enabled } = body;

    if (!id) {
      return jsonError('id is required', 400);
    }

    const updateData: any = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (url !== undefined) {
      // Validate URL
      try {
        await assertSafeOutboundUrl(url);
        updateData.url = url;
      } catch {
        return jsonError('Invalid URL format', 400);
      }
    }
    if (events !== undefined) {
      if (!Array.isArray(events)) {
        return jsonError('events must be an array', 400);
      }
      updateData.events = events;
    }
    if (enabled !== undefined) {
      updateData.enabled = enabled;
    }

    if (Object.keys(updateData).length === 0) {
      return jsonError('No fields to update', 400);
    }

    const webhook = await prisma.statusPageWebhook.update({
      where: { id },
      data: updateData,
    });

    logger.info('api.status_page.webhook.updated', { webhookId: id });
    return jsonOk({ webhook }, 200);
  } catch (error: any) {
    if (error.code === 'P2025') {
      return jsonError('Webhook not found', 404);
    }
    logger.error('api.status_page.webhook.update_error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError('Failed to update webhook', 500);
  }
}

/**
 * DELETE /api/status-page/webhooks?id=xxx
 */
export async function DELETE(req: NextRequest) {
  try {
    await assertAdmin();
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unauthorized', 403);
  }

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return jsonError('id is required', 400);
    }

    await prisma.statusPageWebhook.delete({
      where: { id },
    });

    logger.info('api.status_page.webhook.deleted', { webhookId: id });
    return jsonOk({ success: true }, 200);
  } catch (error: any) {
    logger.error('api.status_page.webhook.delete_error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError('Failed to delete webhook', 500);
  }
}
