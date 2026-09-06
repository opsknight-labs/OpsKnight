'use server';

import { NextRequest } from 'next/server';
import { assertAdmin } from '@/lib/rbac';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { retryFetch } from '@/lib/retry';
import { decrypt } from '@/lib/encryption';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { integrationProviderError, jsonProviderError } from '@/lib/provider-errors';

/**
 * POST /api/slack/channels/leave
 * Bot leaves a Slack channel
 */
export async function POST(request: NextRequest) {
  try {
    const user = await assertAdmin();

    let body: unknown;
    try {
      body = await request.json();
    } catch (error) {
      return jsonError(new AppError({ code: 'INVALID_JSON', cause: error }));
    }
    const payload = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const channelId = typeof payload.channelId === 'string' ? payload.channelId : null;

    if (!channelId) {
      return jsonError(
        new AppError({
          code: 'VALIDATION_FAILED',
          userMessage: 'Channel ID is required.',
          fields: [{ field: 'channelId', code: 'required', message: 'Channel ID is required' }],
        })
      );
    }

    const globalIntegration = await prisma.slackIntegration.findFirst({
      where: {
        enabled: true,
        services: { none: {} },
      },
    });

    if (!globalIntegration?.botToken) {
      return jsonError(
        new AppError({
          code: 'NOTIFICATION_PROVIDER_UNAVAILABLE',
          userMessage: 'Slack is not configured.',
          action: 'Connect a Slack workspace before managing channels.',
          retryable: false,
          details: { provider: 'slack', reason: 'not_configured' },
        })
      );
    }

    let botToken: string;
    try {
      botToken = await decrypt(globalIntegration.botToken);
    } catch (error) {
      throw new AppError({
        code: 'INTERNAL_ERROR',
        details: { provider: 'slack', operation: 'decrypt_token' },
        cause: error,
      });
    }

    let response: Response;
    try {
      response = await retryFetch(
        'https://slack.com/api/conversations.leave',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${botToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ channel: channelId }),
        },
        { maxAttempts: 2, initialDelayMs: 500 }
      );
    } catch (error) {
      throw integrationProviderError({
        provider: 'slack',
        operation: 'conversations.leave',
        cause: error,
      });
    }

    const data = await response.json();

    if (!data.ok) {
      const providerCode = typeof data.error === 'string' ? data.error : undefined;
      logger.warn('[Slack] Failed to leave channel', { error: providerCode, channelId });
      const providerError = integrationProviderError({
        provider: 'slack',
        operation: 'conversations.leave',
        providerCode,
        status: response.status,
      });
      return jsonProviderError(providerError, {
        legacyError: providerCode || 'Failed to leave channel',
        provider: 'slack',
        providerCode,
      });
    }

    logger.info('[Slack] Bot left channel', { channelId, userId: user.id });
    return jsonOk({ ok: true });
  } catch (error) {
    logger.error('[Slack] Leave channel error', {
      error,
      errorCode: isAppError(error) ? error.code : 'INTERNAL_ERROR',
    });
    if (isAppError(error)) return jsonError(error);
    return jsonError('Failed to leave channel', 500);
  }
}
