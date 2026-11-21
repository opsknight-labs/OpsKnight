import 'server-only';
import { decrypt, encrypt } from '@/lib/encryption';
import type { ChatProvider } from '@/lib/chatops/provider';
import {
  answerSlackSquireMention,
  deliverSlackSquireReply,
  type SlackSquireMentionPayload,
  type SlackSquireReply,
} from './slack';
import {
  answerTeamsSquireMention,
  deliverTeamsSquireReply,
  type TeamsSquireMentionPayload,
  type TeamsSquireReply,
} from './teams';

/**
 * Squire mentions ride the durable ChatOps intent pipeline: the effect computes the answer (read-only;
 * proposals are sealed, nothing runs) and the response step posts it in the thread, retried on failure.
 * The stored response is the rendered answer, which can name people and quote incident text, so it is
 * kept encrypted like the request payload rather than as plain JSON.
 */

export const SQUIRE_MENTION_KIND = 'SQUIRE_MENTION';

export function isSquireMentionPayload(payload: Record<string, unknown>): boolean {
  return payload.__kind === SQUIRE_MENTION_KIND;
}

export async function processSquireMention(
  provider: ChatProvider,
  payload: Record<string, unknown>
): Promise<{ squireReply: string }> {
  const reply =
    provider === 'MICROSOFT_TEAMS'
      ? await answerTeamsSquireMention(payload as unknown as TeamsSquireMentionPayload)
      : await answerSlackSquireMention(payload as unknown as SlackSquireMentionPayload);
  return { squireReply: await encrypt(JSON.stringify(reply)) };
}

export async function deliverSquireMention(
  provider: ChatProvider,
  payload: Record<string, unknown>,
  response: unknown
): Promise<void> {
  const sealed = (response as { squireReply?: unknown } | null)?.squireReply;
  if (typeof sealed !== 'string') return;
  const reply = JSON.parse(await decrypt(sealed)) as unknown;
  if (provider === 'MICROSOFT_TEAMS')
    return deliverTeamsSquireReply(
      payload as unknown as TeamsSquireMentionPayload,
      reply as TeamsSquireReply
    );
  return deliverSlackSquireReply(reply as SlackSquireReply);
}
