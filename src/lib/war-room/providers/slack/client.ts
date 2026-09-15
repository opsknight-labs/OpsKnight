import { logger } from '@/lib/logger';
import { retryFetch } from '@/lib/retry';

const NON_IDEMPOTENT_POST_METHODS = new Set(['conversations.create', 'chat.postMessage']);

export type SlackApiResult = {
  ok: boolean;
  error?: string;
  httpStatus?: number;
  transportFailure?: boolean;
  sideEffectAmbiguous?: boolean;
  channel?: { id: string; name: string };
  channels?: Array<{ id: string; name: string }>;
  user?: { profile?: { email?: string } };
  ts?: string;
  message?: { ts?: string };
  response_metadata?: { next_cursor?: string };
};

export async function slackApiCall(
  method: string,
  botToken: string,
  body: Record<string, unknown>
): Promise<SlackApiResult> {
  const allowRetry = !NON_IDEMPOTENT_POST_METHODS.has(method);
  try {
    if (allowRetry) {
      const response = await retryFetch(
        `https://slack.com/api/${method}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${botToken}`,
          },
          body: JSON.stringify(body),
        },
        {
          maxAttempts: 2,
          initialDelayMs: 500,
          retryableErrors: error => {
            if (error instanceof Error) {
              return (
                error.message.includes('fetch') ||
                error.message.includes('network') ||
                /^HTTP (429|5\d{2}):/.test(error.message)
              );
            }
            return false;
          },
        }
      );
      return (await response.json()) as {
        ok: boolean;
        error?: string;
        channel?: { id: string; name: string };
        channels?: Array<{ id: string; name: string }>;
        user?: { profile?: { email?: string } };
        response_metadata?: { next_cursor?: string };
      };
    }
    // Non-idempotent creates: single attempt only — never blind-retry after a
    // POST that may have had a provider side effect. Callers must reconcile.
    // Preserve structured transport signals instead of folding HTTP status into the string.
    const response = await fetch(`https://slack.com/api/${method}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${botToken}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const isRateLimited = response.status === 429;
      const is5xx = response.status >= 500 && response.status <= 599;
      return {
        ok: false,
        error: text ? text.slice(0, 500) : `HTTP ${response.status}`,
        httpStatus: response.status,
        transportFailure: true,
        sideEffectAmbiguous: isRateLimited || is5xx,
      };
    }
    return (await response.json()) as {
      ok: boolean;
      error?: string;
      channel?: { id: string; name: string };
      channels?: Array<{ id: string; name: string }>;
      user?: { profile?: { email?: string } };
      response_metadata?: { next_cursor?: string };
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('[ChatOps] Slack API call failed', { method, error: message });
    const isTimeoutish = /timeout|fetch|network|econnreset|etimedout/i.test(message);
    return { ok: false, error: message, transportFailure: isTimeoutish, sideEffectAmbiguous: NON_IDEMPOTENT_POST_METHODS.has(method) && isTimeoutish };
  }
}

export function slackWarRoomMarker(incidentId: string, generation: number): string {
  return `[OKWR:${incidentId}:g${generation}]`;
}

export async function findExistingSlackChannel(
  botToken: string,
  channelName: string
): Promise<{ id: string; name: string } | null> {
  let cursor: string | undefined;
  for (let page = 0; page < 100; page += 1) {
    const result = await slackApiCall('conversations.list', botToken, {
      exclude_archived: true,
      limit: 200,
      types: 'public_channel,private_channel',
      ...(cursor ? { cursor } : {}),
    });
    if (!result.ok || !result.channels) return null;
    const found = result.channels.find(channel => channel.name === channelName);
    if (found) return found;
    cursor = result.response_metadata?.next_cursor;
    if (!cursor) break;
  }
  return null;
}

export async function findSlackChannelByMarker(
  botToken: string,
  marker: string
): Promise<{ id: string; name: string } | null> {
  // Marker is stored in channel topic/purpose, which conversations.list does not
  // return. We scan by listing channels then verify each candidate's topic via
  // conversations.info. This is bounded and only used for AMBIGUOUS reconciliation.
  let cursor: string | undefined;
  for (let page = 0; page < 100; page += 1) {
    const result = await slackApiCall('conversations.list', botToken, {
      exclude_archived: true,
      limit: 200,
      types: 'public_channel,private_channel',
      ...(cursor ? { cursor } : {}),
    });
    if (!result.ok || !result.channels) return null;
    for (const channel of result.channels) {
      const info = await slackApiCall('conversations.info', botToken, { channel: channel.id });
      const topic = (info as unknown as { channel?: { topic?: { value?: string }; purpose?: { value?: string } } }).channel?.topic?.value ?? '';
      const purpose = (info as unknown as { channel?: { topic?: { value?: string }; purpose?: { value?: string } } }).channel?.purpose?.value ?? '';
      if (topic.includes(marker) || purpose.includes(marker)) return channel;
    }
    cursor = result.response_metadata?.next_cursor;
    if (!cursor) break;
  }
  return null;
}
