import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { assertAdmin } from '@/lib/rbac';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { prismaToAppError } from '@/lib/prisma-errors';
import { logger } from '@/lib/logger';
import { randomBytes } from 'crypto';
import { assertSafeOutboundUrl } from '@/lib/network-security';
import { encrypt } from '@/lib/encryption';

const LEGACY_REQUIRED_MESSAGE = 'Please fill in all required fields.';
const LEGACY_INVALID_INPUT_MESSAGE = 'Please check your input and try again.';
const LEGACY_NOT_FOUND_MESSAGE =
  'The requested item could not be found. It may have been deleted or you may not have access to it.';

const WEBHOOK_NOT_FOUND = {
  code: 'STATUS_PAGE_WEBHOOK_NOT_FOUND' as const,
  userMessage: LEGACY_NOT_FOUND_MESSAGE,
};

async function requireAdmin() {
  try {
    await assertAdmin();
    return null;
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    return jsonError('Unable to authorize this request', 500);
  }
}

export async function GET(req: NextRequest) {
  const authError = await requireAdmin();
  if (authError) return authError;

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

    return jsonOk({
      webhooks: webhooks.map(webhook => ({ ...webhook, secret: '••••••••', hasSecret: true })),
    });
  } catch (error) {
    logger.error('api.status_page.webhooks.get_error', { error });
    return jsonError('Failed to fetch webhooks', 500);
  }
}

export async function POST(req: NextRequest) {
  const authError = await requireAdmin();
  if (authError) return authError;

  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch (error) {
      return jsonError(new AppError({ code: 'INVALID_JSON', cause: error }));
    }
    const payload = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const statusPageId = typeof payload.statusPageId === 'string' ? payload.statusPageId : null;
    const url = typeof payload.url === 'string' ? payload.url : null;
    const events = Array.isArray(payload.events) ? payload.events : null;

    if (!statusPageId || !url || !events) {
      return jsonError(
        new AppError({ code: 'VALIDATION_FAILED', userMessage: LEGACY_REQUIRED_MESSAGE })
      );
    }

    try {
      await assertSafeOutboundUrl(url);
    } catch (error) {
      return jsonError(
        new AppError({
          code: 'VALIDATION_FAILED',
          userMessage: LEGACY_INVALID_INPUT_MESSAGE,
          fields: [{ field: 'url', code: 'invalid', message: 'Invalid URL format' }],
          cause: error,
        })
      );
    }

    const secret = randomBytes(32).toString('hex');
    const webhook = await prisma.statusPageWebhook.create({
      data: {
        statusPageId,
        url,
        secret: await encrypt(secret),
        events,
        enabled: true,
      },
    });

    logger.info('api.status_page.webhook.created', { webhookId: webhook.id, statusPageId });
    return jsonOk({ webhook: { ...webhook, secret }, hasSecret: true }, 201);
  } catch (error) {
    logger.error('api.status_page.webhook.create_error', { error });
    return jsonError('Failed to create webhook', 500);
  }
}

export async function PATCH(req: NextRequest) {
  const authError = await requireAdmin();
  if (authError) return authError;

  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch (error) {
      return jsonError(new AppError({ code: 'INVALID_JSON', cause: error }));
    }
    const payload = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const id = typeof payload.id === 'string' ? payload.id : null;

    if (!id) {
      return jsonError(
        new AppError({
          code: 'VALIDATION_FAILED',
          userMessage: LEGACY_REQUIRED_MESSAGE,
          fields: [{ field: 'id', code: 'required', message: 'id is required' }],
        })
      );
    }

    const updateData: Record<string, unknown> = {};
    if (payload.url !== undefined) {
      if (typeof payload.url !== 'string') {
        return jsonError(
          new AppError({
            code: 'VALIDATION_FAILED',
            userMessage: LEGACY_INVALID_INPUT_MESSAGE,
            fields: [{ field: 'url', code: 'invalid_type', message: 'url must be a string' }],
          })
        );
      }
      try {
        await assertSafeOutboundUrl(payload.url);
        updateData.url = payload.url;
      } catch (error) {
        return jsonError(
          new AppError({
            code: 'VALIDATION_FAILED',
            userMessage: LEGACY_INVALID_INPUT_MESSAGE,
            fields: [{ field: 'url', code: 'invalid', message: 'Invalid URL format' }],
            cause: error,
          })
        );
      }
    }
    if (payload.events !== undefined) {
      if (!Array.isArray(payload.events)) {
        return jsonError(
          new AppError({
            code: 'VALIDATION_FAILED',
            userMessage: 'events must be an array',
            fields: [{ field: 'events', code: 'invalid_type', message: 'events must be an array' }],
          })
        );
      }
      updateData.events = payload.events;
    }
    if (payload.enabled !== undefined) {
      if (typeof payload.enabled !== 'boolean') {
        return jsonError(
          new AppError({
            code: 'VALIDATION_FAILED',
            userMessage: 'enabled must be a boolean',
            fields: [{ field: 'enabled', code: 'invalid_type', message: 'enabled must be a boolean' }],
          })
        );
      }
      updateData.enabled = payload.enabled;
    }

    if (Object.keys(updateData).length === 0) {
      return jsonError(
        new AppError({ code: 'VALIDATION_FAILED', userMessage: 'No fields to update' })
      );
    }

    const webhook = await prisma.statusPageWebhook.update({ where: { id }, data: updateData });

    logger.info('api.status_page.webhook.updated', { webhookId: id });
    return jsonOk({ webhook }, 200);
  } catch (error) {
    const prismaError = prismaToAppError(error, { notFound: WEBHOOK_NOT_FOUND });
    if (prismaError) return jsonError(prismaError);
    if (isAppError(error)) return jsonError(error);

    logger.error('api.status_page.webhook.update_error', { error });
    return jsonError('Failed to update webhook', 500);
  }
}

export async function DELETE(req: NextRequest) {
  const authError = await requireAdmin();
  if (authError) return authError;

  try {
    const id = new URL(req.url).searchParams.get('id');

    if (!id) {
      return jsonError(
        new AppError({
          code: 'VALIDATION_FAILED',
          userMessage: LEGACY_REQUIRED_MESSAGE,
          fields: [{ field: 'id', code: 'required', message: 'id is required' }],
        })
      );
    }

    await prisma.statusPageWebhook.delete({ where: { id } });

    logger.info('api.status_page.webhook.deleted', { webhookId: id });
    return jsonOk({ success: true }, 200);
  } catch (error) {
    const prismaError = prismaToAppError(error, { notFound: WEBHOOK_NOT_FOUND });
    if (prismaError) return jsonError(prismaError);
    if (isAppError(error)) return jsonError(error);

    logger.error('api.status_page.webhook.delete_error', { error });
    return jsonError('Failed to delete webhook', 500);
  }
}
