import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { assertAdmin } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { randomBytes } from 'crypto';
import { assertSafeOutboundUrl } from '@/lib/network-security';
import { encrypt } from '@/lib/encryption';

const LEGACY_UNAUTHORIZED_MESSAGE =
  'You do not have permission to perform this action. Please contact an administrator if you believe this is an error.';
const LEGACY_REQUIRED_MESSAGE = 'Please fill in all required fields.';
const LEGACY_INVALID_INPUT_MESSAGE = 'Please check your input and try again.';
const LEGACY_NOT_FOUND_MESSAGE =
  'The requested item could not be found. It may have been deleted or you may not have access to it.';

function adminDenied() {
  return jsonError(
    new AppError({
      code: 'AUTHORIZATION_DENIED',
      userMessage: LEGACY_UNAUTHORIZED_MESSAGE,
    })
  );
}

export async function GET(req: NextRequest) {
  try {
    await assertAdmin();
  } catch {
    return adminDenied();
  }

  try {
    const { searchParams } = new URL(req.url);
    const statusPageId = searchParams.get('statusPageId');

    if (!statusPageId) {
      return jsonError(
        new AppError({
          code: 'VALIDATION_FAILED',
          userMessage: LEGACY_REQUIRED_MESSAGE,
          fields: [
            { field: 'statusPageId', code: 'required', message: 'statusPageId is required' },
          ],
        })
      );
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
  } catch {
    return adminDenied();
  }

  try {
    const body = await req.json();
    const { statusPageId, url, events } = body;

    if (!statusPageId || !url || !events || !Array.isArray(events)) {
      return jsonError(
        new AppError({
          code: 'VALIDATION_FAILED',
          userMessage: LEGACY_REQUIRED_MESSAGE,
        })
      );
    }

    try {
      await assertSafeOutboundUrl(url);
    } catch {
      return jsonError(
        new AppError({
          code: 'VALIDATION_FAILED',
          userMessage: LEGACY_INVALID_INPUT_MESSAGE,
          fields: [{ field: 'url', code: 'invalid', message: 'Invalid URL format' }],
        })
      );
    }

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

export async function PATCH(req: NextRequest) {
  try {
    await assertAdmin();
  } catch {
    return adminDenied();
  }

  try {
    const body = await req.json();
    const { id, url, events, enabled } = body;

    if (!id) {
      return jsonError(
        new AppError({
          code: 'VALIDATION_FAILED',
          userMessage: LEGACY_REQUIRED_MESSAGE,
          fields: [{ field: 'id', code: 'required', message: 'id is required' }],
        })
      );
    }

    const updateData: any = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (url !== undefined) {
      try {
        await assertSafeOutboundUrl(url);
        updateData.url = url;
      } catch {
        return jsonError(
          new AppError({
            code: 'VALIDATION_FAILED',
            userMessage: LEGACY_INVALID_INPUT_MESSAGE,
            fields: [{ field: 'url', code: 'invalid', message: 'Invalid URL format' }],
          })
        );
      }
    }
    if (events !== undefined) {
      if (!Array.isArray(events)) {
        return jsonError(
          new AppError({
            code: 'VALIDATION_FAILED',
            userMessage: 'events must be an array',
            fields: [{ field: 'events', code: 'invalid_type', message: 'events must be an array' }],
          })
        );
      }
      updateData.events = events;
    }
    if (enabled !== undefined) {
      updateData.enabled = enabled;
    }

    if (Object.keys(updateData).length === 0) {
      return jsonError(
        new AppError({
          code: 'VALIDATION_FAILED',
          userMessage: 'No fields to update',
        })
      );
    }

    const webhook = await prisma.statusPageWebhook.update({
      where: { id },
      data: updateData,
    });

    logger.info('api.status_page.webhook.updated', { webhookId: id });
    return jsonOk({ webhook }, 200);
  } catch (error: any) {
    if (error.code === 'P2025') {
      return jsonError(
        new AppError({
          code: 'STATUS_PAGE_WEBHOOK_NOT_FOUND',
          userMessage: LEGACY_NOT_FOUND_MESSAGE,
        })
      );
    }
    logger.error('api.status_page.webhook.update_error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError('Failed to update webhook', 500);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await assertAdmin();
  } catch {
    return adminDenied();
  }

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return jsonError(
        new AppError({
          code: 'VALIDATION_FAILED',
          userMessage: LEGACY_REQUIRED_MESSAGE,
          fields: [{ field: 'id', code: 'required', message: 'id is required' }],
        })
      );
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
