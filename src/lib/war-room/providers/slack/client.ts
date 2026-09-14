import { logger } from '@/lib/logger';
import { retryFetch } from '@/lib/retry';

export async function slackApiCall(
  method: string,
  botToken: string,
  body: Record<string, unknown>
): Promise<{
  ok: boolean;
  error?: string;
  channel?: { id: string; name: string };
  channels?: Array<{ id: string; name: string }>;
  user?: { profile?: { email?: string } };
}> {
  try {
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
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('[ChatOps] Slack API call failed', { method, error: message });
    return { ok: false, error: message };
  }
}

export async function findExistingSlackChannel(
  botToken: string,
  channelName: string
): Promise<{ id: string; name: string } | null> {
  const result = await slackApiCall('conversations.list', botToken, {
    exclude_archived: true,
    limit: 1000,
    types: 'public_channel,private_channel',
  });
  return result.channels?.find(channel => channel.name === channelName) || null;
}
