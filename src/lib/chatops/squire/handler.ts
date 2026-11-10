import 'server-only';
import { resolveUserActor } from '@/lib/authorization-actors';
import { checkRateLimit } from '@/lib/rate-limit';
import { getBaseUrl } from '@/lib/env-validation';
import { logger } from '@/lib/logger';
import { getAiSettings } from '@/lib/intelligence/ai/settings';
import { collectSquireTurn } from '@/lib/intelligence/squire/surfaces';
import { executeSquireAction } from '@/lib/intelligence/squire/actions/execute';
import { isChatConfirmableAction } from '@/lib/intelligence/squire/actions/catalog';
import type { ChatSquireAnswer } from './render';

/**
 * Squire in Slack and Microsoft Teams, independent of the transport.
 *
 * The transport resolves the chat account to an OpsKnight user through its existing identity mapping
 * (verified Slack email, Teams identity link) and finds the channel's incident. From there this module
 * runs the same turn as the web assistant under that user's own permissions, and confirms proposals only
 * through the sealed proposal executor, for the person the proposal was made for.
 */

export type SquireChatProvider = 'SLACK' | 'MICROSOFT_TEAMS';

/** Questions per person per minute across Slack and Teams. A turn can be an AI call. */
export const SQUIRE_CHAT_QUESTIONS_PER_MINUTE = 6;
/** Confirm clicks per person per minute. */
export const SQUIRE_CHAT_CONFIRMS_PER_MINUTE = 20;

export const SQUIRE_CHAT_DISABLED =
  'Squire is not turned on for chat. An administrator can enable it in Settings → Intelligence → AI.';
export const SQUIRE_CHAT_NOT_LINKED =
  'Your chat account is not linked to an active OpsKnight account, so Squire cannot answer for you.';
export const SQUIRE_CHAT_NOT_OWNER =
  'Only the person who asked Squire can confirm this suggestion. Ask Squire yourself for your own.';
export const SQUIRE_CHAT_RATE_LIMITED = 'You are asking Squire quickly. Try again in a minute.';
const EMPTY_QUESTION =
  'Ask a question after @squire, for example “@squire what changed before this started?”';

export function chatBaseUrl(): string {
  try {
    return getBaseUrl().replace(/\/+$/, '');
  } catch {
    return 'http://localhost:3000';
  }
}

/** Both switches: the assistant itself and its chat surface. Fails closed. */
export async function isSquireChatOpsEnabled(): Promise<boolean> {
  try {
    const settings = await getAiSettings();
    return settings.squireEnabled && settings.squireChatOpsEnabled;
  } catch {
    return false;
  }
}

const failure = (error: string): ChatSquireAnswer => ({
  name: 'Squire',
  mode: 'basic',
  text: '',
  notices: [],
  citations: [],
  proposals: [],
  error,
});

/** Answers one question for a linked user, with the channel's incident as context. */
export async function answerChatQuestion(input: {
  provider: SquireChatProvider;
  /** OpsKnight user resolved from the chat identity; null when the account is not linked. */
  userId: string | null;
  question: string;
  incidentId: string | null;
}): Promise<ChatSquireAnswer> {
  if (!(await isSquireChatOpsEnabled())) return failure(SQUIRE_CHAT_DISABLED);
  if (!input.userId) return failure(SQUIRE_CHAT_NOT_LINKED);
  const question = input.question.trim();
  if (!question) return failure(EMPTY_QUESTION);
  const rate = await checkRateLimit(
    `squire:chatops:ask:${input.userId}`,
    SQUIRE_CHAT_QUESTIONS_PER_MINUTE,
    60_000
  );
  if (!rate.allowed) return failure(SQUIRE_CHAT_RATE_LIMITED);
  const actor = await resolveUserActor(input.userId);
  if (!actor || actor.status !== 'ACTIVE') return failure(SQUIRE_CHAT_NOT_LINKED);
  const answer = await collectSquireTurn(actor, {
    message: question,
    ...(input.incidentId ? { incidentId: input.incidentId } : {}),
  });
  logger.info('[Squire] Chat question answered', {
    provider: input.provider,
    mode: answer.mode,
    failed: Boolean(answer.error),
    proposals: answer.proposals.length,
  });
  return {
    name: answer.name,
    mode: answer.mode,
    text: answer.text,
    notices: answer.notices,
    citations: answer.citations.map(({ kind, label, href }) => ({ kind, label, href })),
    proposals: answer.proposals.map(proposal => ({
      token: proposal.token,
      kind: proposal.kind,
      title: proposal.title,
      detail: proposal.detail,
      incidentId: proposal.incidentId,
      expiresAt: proposal.expiresAt,
      ...(proposal.href ? { href: proposal.href } : {}),
      ...(proposal.untrustedContext ? { untrustedContext: true } : {}),
      chatConfirmable: proposal.kind === 'WRITE' && isChatConfirmableAction(proposal.action),
    })),
    ...(answer.error ? { error: answer.error } : {}),
  };
}

export interface ChatConfirmResult {
  ok: boolean;
  message: string;
  href?: string;
  /** The clicking person is not the one the proposal was made for. */
  denied?: boolean;
}

/**
 * Confirms a proposal clicked in chat. The outcome is only ever what the executor returned with its
 * receipt; nothing here reports success on its own.
 */
export async function confirmChatProposal(input: {
  provider: SquireChatProvider;
  /** OpsKnight user resolved from the clicking chat account; null when not linked. */
  userId: string | null;
  actorName: string;
  token: string;
  /** Owner recorded on the button; checked here for a clear message, and again by the executor. */
  owner: string;
}): Promise<ChatConfirmResult> {
  if (!input.userId) return { ok: false, message: SQUIRE_CHAT_NOT_LINKED };
  if (input.owner !== input.userId)
    return { ok: false, denied: true, message: SQUIRE_CHAT_NOT_OWNER };
  if (!(await isSquireChatOpsEnabled())) return { ok: false, message: SQUIRE_CHAT_DISABLED };
  const rate = await checkRateLimit(
    `squire:chatops:confirm:${input.userId}`,
    SQUIRE_CHAT_CONFIRMS_PER_MINUTE,
    60_000
  );
  if (!rate.allowed) return { ok: false, message: SQUIRE_CHAT_RATE_LIMITED };
  const actor = await resolveUserActor(input.userId);
  if (!actor || actor.status !== 'ACTIVE') return { ok: false, message: SQUIRE_CHAT_NOT_LINKED };
  const result = await executeSquireAction(actor, input.token, {
    provider: input.provider,
    actorName: input.actorName,
  });
  return result.ok
    ? {
        ok: true,
        message: result.message,
        ...(result.href ? { href: `${chatBaseUrl()}${result.href}` } : {}),
      }
    : { ok: false, message: result.message };
}
