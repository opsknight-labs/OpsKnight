import { z } from 'zod';
import { logger } from '@/lib/logger';
import { slackApiCall } from './client';

export const SLACK_CONNECT_SCOPE = 'conversations.connect:write';
const emailSchema = z.string().trim().toLowerCase().email();

/**
 * Invites the configured external emails to a new war room through Slack Connect. Runs only when the
 * install holds the optional conversations.connect:write scope; every failure is logged and swallowed
 * so it can never fail provisioning. Returns how many invites Slack accepted.
 */
export async function inviteWarRoomExternalGuests(input: {
  botToken: string;
  channelId: string;
  emails: readonly string[] | null | undefined;
  scopes: readonly string[];
}): Promise<number> {
  if (!input.emails?.length || !input.scopes.includes(SLACK_CONNECT_SCOPE)) return 0;
  const emails = [
    ...new Set(
      input.emails.flatMap(email => {
        const parsed = emailSchema.safeParse(email);
        return parsed.success ? [parsed.data] : [];
      })
    ),
  ].slice(0, 20);
  let invited = 0;
  for (const email of emails) {
    try {
      const result = await slackApiCall('conversations.inviteShared', input.botToken, {
        channel: input.channelId,
        emails: email,
        external_limited: true,
      });
      if (result.ok) invited += 1;
      else logger.warn('[ChatOps] Slack Connect invite failed', { error: result.error });
    } catch (error) {
      logger.warn('[ChatOps] Slack Connect invite failed', { error: String(error) });
    }
  }
  return invited;
}
