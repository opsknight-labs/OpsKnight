import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/rbac';
import { logger } from '@/lib/logger';
import { retryFetch } from '@/lib/retry';
import { getSlackBotToken } from '@/lib/slack';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { integrationProviderError, jsonProviderError } from '@/lib/provider-errors';

type SlackApiChannel = {
  id: string;
  name: string;
  is_channel?: boolean;
  is_archived?: boolean;
  is_private?: boolean;
  is_member?: boolean;
};

const SLACK_CHANNEL_TYPES = 'public_channel,private_channel';

function slackNotConfigured() {
  return new AppError({
    code: 'NOTIFICATION_PROVIDER_UNAVAILABLE',
    userMessage: 'Slack is not configured.',
    action: 'Connect a Slack workspace before managing channels.',
    retryable: false,
    details: { provider: 'slack', reason: 'not_configured' },
  });
}

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return jsonError(new AppError({ code: 'AUTHENTICATION_REQUIRED' }));
    }

    const { searchParams } = new URL(request.url);
    const serviceId = searchParams.get('serviceId');
    const botToken = await getSlackBotToken(serviceId || undefined);

    if (!botToken) {
      return jsonError(slackNotConfigured());
    }

    const listUrl = new URL('https://slack.com/api/conversations.list');
    listUrl.searchParams.set('exclude_archived', 'true');
    listUrl.searchParams.set('limit', '200');
    listUrl.searchParams.set('types', SLACK_CHANNEL_TYPES);

    let response: Response;
    try {
      response = await retryFetch(
        listUrl.toString(),
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${botToken}`,
            'Content-Type': 'application/json',
          },
        },
        { maxAttempts: 2, initialDelayMs: 500 }
      );
    } catch (error) {
      throw integrationProviderError({
        provider: 'slack',
        operation: 'conversations.list',
        cause: error,
      });
    }

    const data = await response.json();

    if (!data.ok) {
      logger.error('[Slack] Failed to fetch channels', { error: data.error });
      const providerError = integrationProviderError({
        provider: 'slack',
        operation: 'conversations.list',
        providerCode: typeof data.error === 'string' ? data.error : undefined,
        status: response.status,
      });
      return jsonProviderError(providerError, {
        legacyError: typeof data.error === 'string' ? data.error : 'Failed to fetch channels',
        provider: 'slack',
        providerCode: typeof data.error === 'string' ? data.error : undefined,
      });
    }

    const channels = (data.channels || [])
      .filter((channel: SlackApiChannel) => channel.is_channel && !channel.is_archived)
      .map((channel: SlackApiChannel) => ({
        id: channel.id,
        name: channel.name,
        isPrivate: Boolean(channel.is_private),
        isMember: Boolean(channel.is_member),
      }))
      .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name));

    return jsonOk({ channels });
  } catch (error) {
    logger.error('[Slack] Channels API error', {
      error,
      errorCode: isAppError(error) ? error.code : 'INTERNAL_ERROR',
    });
    if (isAppError(error)) return jsonError(error);
    return jsonError('Internal server error', 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return jsonError(new AppError({ code: 'AUTHENTICATION_REQUIRED' }));
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch (error) {
      return jsonError(new AppError({ code: 'INVALID_JSON', cause: error }));
    }

    const payload = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const channelId = typeof payload.channelId === 'string' ? payload.channelId : null;
    const serviceId = typeof payload.serviceId === 'string' ? payload.serviceId : null;

    if (!channelId) {
      return jsonError(
        new AppError({
          code: 'VALIDATION_FAILED',
          userMessage: 'Channel ID is required.',
          fields: [{ field: 'channelId', code: 'required', message: 'Channel ID is required' }],
        })
      );
    }

    const botToken = await getSlackBotToken(serviceId || undefined);
    if (!botToken) {
      return jsonError(slackNotConfigured());
    }

    let response: Response;
    try {
      response = await retryFetch(
        'https://slack.com/api/conversations.join',
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
        operation: 'conversations.join',
        cause: error,
      });
    }

    const data = await response.json();

    if (!data.ok) {
      const providerCode = typeof data.error === 'string' ? data.error : undefined;
      logger.warn('[Slack] Failed to join channel', { error: providerCode, channelId });
      const providerError = integrationProviderError({
        provider: 'slack',
        operation: 'conversations.join',
        providerCode,
        status: response.status,
      });
      return jsonProviderError(providerError, {
        legacyError: providerCode || 'Failed to join channel',
        provider: 'slack',
        providerCode,
      });
    }

    return jsonOk({ ok: true });
  } catch (error) {
    logger.error('[Slack] Join channel error', {
      error,
      errorCode: isAppError(error) ? error.code : 'INTERNAL_ERROR',
    });
    if (isAppError(error)) return jsonError(error);
    return jsonError('Internal server error', 500);
  }
}
