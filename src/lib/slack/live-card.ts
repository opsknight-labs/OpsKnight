/**
 * One live incident card per incident per service Slack channel.
 *
 * The first delivery posts the card and stores its `ts`; later events edit it in place
 * (chat.update, which notifies nobody) and add a short threaded reply. A card that cannot be
 * found or edited any more is replaced by a new post, which is also what happens for incidents
 * whose card predates this table. Two deliveries racing for the same incident and channel
 * coordinate through the (incidentId, channel) unique row: only the claim holder posts.
 */
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getBaseUrl } from '@/lib/env-validation';
import { escapeSlack } from '@/lib/chatops/squire/render';
import { callSlackApi, classifySlackError, type SlackApiResult } from './api';
import {
  buildIncidentCard,
  buildThreadReply,
  threadReplyBroadcasts,
  type SlackCardEvent,
  type SlackCardIncident,
  type SlackCardMessage,
} from './incident-card';

/** How a service notification wants the channel card delivered. */
export type SlackLiveCardRequest = {
  event: SlackCardEvent;
  /** Unique per logical event, so a retried delivery does not post the same thread reply twice. */
  eventKey: string;
  /** Post a thread reply (false when the service's notify toggle for this event is off). */
  reply: boolean;
  /** Only edit an existing card; never post a new one (used when notifications for the event are off). */
  editOnly?: boolean;
};

export type SlackInstall = { token: string; scopes: string[]; workspaceId: string | null };

export type LiveCardResult = {
  success: boolean;
  error?: string;
  errorCode?: string;
  statusCode?: number;
  retryAfterMs?: number;
  skipped?: boolean;
  ts?: string;
  channel?: string;
  updated?: boolean;
};

type CardRef = {
  id: string;
  channelId: string | null;
  ts: string | null;
  lastEventKey: string | null;
  updatedAt: Date;
};

type CardStore = {
  findUnique(args: unknown): Promise<CardRef | null>;
  create(args: unknown): Promise<CardRef>;
  update(args: unknown): Promise<unknown>;
  updateMany(args: unknown): Promise<{ count: number }>;
  deleteMany(args: unknown): Promise<{ count: number }>;
};

/** A claim older than this belongs to a sender that died between claiming and posting. */
export const STALE_CLAIM_MS = 2 * 60_000;

function cardStore(): CardStore | undefined {
  // Absent on a client generated before the migration (and in narrow test mocks): degrade to posting.
  return (prisma as unknown as { slackIncidentMessage?: CardStore }).slackIncidentMessage;
}

export type LiveCardPlan =
  | { kind: 'update'; reply: boolean }
  | { kind: 'claim' }
  | { kind: 'takeover' }
  | { kind: 'busy' }
  | { kind: 'skip' };

/** Pure decision: edit the stored card, create one, wait for another sender, or do nothing. */
export function planLiveCardDelivery(
  ref: Pick<CardRef, 'channelId' | 'ts' | 'lastEventKey' | 'updatedAt'> | null,
  request: SlackLiveCardRequest,
  now: Date = new Date()
): LiveCardPlan {
  if (ref?.ts && ref.channelId) {
    return {
      kind: 'update',
      reply: request.reply && request.event !== 'updated' && ref.lastEventKey !== request.eventKey,
    };
  }
  if (request.editOnly) return { kind: 'skip' };
  if (!ref) return { kind: 'claim' };
  return now.getTime() - ref.updatedAt.getTime() > STALE_CLAIM_MS
    ? { kind: 'takeover' }
    : { kind: 'busy' };
}

const slackIdCache = new Map<string, { id: string | null; expiresAt: number }>();
const SLACK_ID_HIT_TTL_MS = 60 * 60_000;
const SLACK_ID_MISS_TTL_MS = 10 * 60_000;

/** Maps an email to a Slack member ID for a real mention. Needs `users:read.email`; cached. */
export async function lookupSlackUserIdByEmail(
  install: SlackInstall,
  email: string | null | undefined
): Promise<string | null> {
  const normalized = email?.trim().toLowerCase();
  if (!normalized || !install.scopes.includes('users:read.email')) return null;
  const key = `${install.workspaceId ?? 'env'}:${normalized}`;
  const cached = slackIdCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.id;
  const result = await callSlackApi<{
    user?: { id?: string; deleted?: boolean; is_bot?: boolean };
  }>('users.lookupByEmail', install.token, { email: normalized }, { form: true, timeoutMs: 3_000 });
  const user = result.ok ? result.data.user : undefined;
  const id = user?.id && !user.deleted && !user.is_bot ? user.id : null;
  // Cache misses too (users_not_found), but not transient failures.
  if (result.ok || result.error === 'users_not_found') {
    if (slackIdCache.size > 1_000) slackIdCache.clear();
    slackIdCache.set(key, {
      id,
      expiresAt: Date.now() + (id ? SLACK_ID_HIT_TTL_MS : SLACK_ID_MISS_TTL_MS),
    });
  }
  return id;
}

/** Fresh incident state for the card, so an edit always shows the current truth. */
export async function loadSlackCardIncident(
  incidentId: string,
  install: SlackInstall,
  options: { withAcknowledger?: boolean } = {}
): Promise<{ incident: SlackCardIncident; acknowledger: string | null } | null> {
  const row = await prisma.incident.findUnique({
    where: { id: incidentId },
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      urgency: true,
      priority: true,
      createdAt: true,
      acknowledgedAt: true,
      resolvedAt: true,
      snoozedUntil: true,
      currentEscalationStep: true,
      acknowledgedById: true,
      service: { select: { name: true } },
      assignee: { select: { name: true, email: true } },
    },
  });
  if (!row) return null;
  const assigneeSlackId = await lookupSlackUserIdByEmail(install, row.assignee?.email).catch(
    () => null
  );
  let acknowledger: string | null = null;
  if (options.withAcknowledger && row.acknowledgedById) {
    const user = await prisma.user.findUnique({
      where: { id: row.acknowledgedById },
      select: { name: true, email: true },
    });
    const slackId = await lookupSlackUserIdByEmail(install, user?.email).catch(() => null);
    acknowledger = slackId ? `<@${slackId}>` : user?.name ? escapeSlack(user.name) : null;
  }
  return {
    acknowledger,
    incident: {
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status,
      urgency: row.urgency,
      priority: row.priority,
      serviceName: row.service.name,
      createdAt: row.createdAt,
      acknowledgedAt: row.acknowledgedAt,
      resolvedAt: row.resolvedAt,
      snoozedUntil: row.snoozedUntil,
      escalationStep: row.currentEscalationStep,
      assigneeName: row.assignee?.name ?? null,
      assigneeSlackId,
    },
  };
}

function failure(result: Extract<SlackApiResult<unknown>, { ok: false }>): LiveCardResult {
  const rateLimited = classifySlackError(result.error, result.status) === 'rate_limited';
  return {
    success: false,
    error: result.error,
    errorCode: result.error,
    statusCode: rateLimited ? 429 : result.status,
    retryAfterMs: rateLimited ? result.retryAfterMs : undefined,
  };
}

/**
 * chat.postMessage, joining a public channel once on `not_in_channel` when the install has
 * `channels:join` (old installs without it fail exactly as before).
 */
export async function postSlackChannelMessage(
  install: SlackInstall,
  channel: string,
  message: Record<string, unknown>,
  maxAttempts: number
): Promise<SlackApiResult<{ ts?: string; channel?: string }>> {
  const post = () =>
    callSlackApi<{ ts?: string; channel?: string }>(
      'chat.postMessage',
      install.token,
      { channel, ...message },
      { maxAttempts }
    );
  const first = await post();
  if (
    first.ok ||
    first.error !== 'not_in_channel' ||
    !/^C[A-Z0-9]+$/.test(channel) ||
    !install.scopes.includes('channels:join')
  ) {
    return first;
  }
  const joined = await callSlackApi('conversations.join', install.token, { channel });
  if (!joined.ok) {
    logger.warn('[Slack] Could not join channel after not_in_channel', {
      channel,
      error: joined.error,
    });
    return first;
  }
  return post();
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown })?.code === 'P2002';
}

export async function deliverLiveIncidentCard(input: {
  install: SlackInstall;
  incidentId: string;
  /** Configured target (channel ID or name), the dedup key. */
  channel: string;
  /** Address as sent to chat.postMessage (names carry a leading #). */
  postChannel: string;
  request: SlackLiveCardRequest;
  interactive: boolean;
  note?: string;
  maxAttempts: number;
}): Promise<LiveCardResult> {
  const { install, request } = input;
  const loaded = await loadSlackCardIncident(input.incidentId, input.install, {
    withAcknowledger: request.event === 'acknowledged',
  });
  if (!loaded) return { success: true, skipped: true };
  const card: SlackCardMessage = buildIncidentCard(loaded.incident, {
    appUrl: getBaseUrl(),
    interactive: input.interactive,
    note: input.note,
  });
  const message = { text: card.text, blocks: card.blocks, attachments: card.attachments };
  const store = cardStore();
  if (!store) {
    if (request.editOnly) return { success: true, skipped: true };
    const posted = await postSlackChannelMessage(
      install,
      input.postChannel,
      message,
      input.maxAttempts
    );
    return posted.ok
      ? { success: true, ts: posted.data.ts, channel: posted.data.channel }
      : failure(posted);
  }

  const where = { incidentId_channel: { incidentId: input.incidentId, channel: input.channel } };
  let ref = await store.findUnique({ where });
  let plan = planLiveCardDelivery(ref, request);

  if (plan.kind === 'update' && ref?.ts && ref.channelId) {
    const updated = await callSlackApi<{ ts?: string }>(
      'chat.update',
      install.token,
      { channel: ref.channelId, ts: ref.ts, ...message },
      { maxAttempts: input.maxAttempts }
    );
    if (updated.ok) {
      const replyText = plan.reply
        ? buildThreadReply(request.event, loaded.incident, { actor: loaded.acknowledger })
        : null;
      if (replyText) {
        const reply = await callSlackApi(
          'chat.postMessage',
          install.token,
          {
            channel: ref.channelId,
            thread_ts: ref.ts,
            text: replyText,
            ...(threadReplyBroadcasts(request.event) ? { reply_broadcast: true } : {}),
          },
          { maxAttempts: input.maxAttempts }
        );
        if (!reply.ok) {
          const kind = classifySlackError(reply.error, reply.status);
          // The card is already current; only a transient reply failure is worth a retry.
          if (kind === 'rate_limited' || kind === 'retryable' || reply.status === undefined) {
            return failure(reply);
          }
          logger.warn('[Slack] Thread reply failed', {
            channel: ref.channelId,
            error: reply.error,
          });
        }
      }
      await store.update({
        where: { id: ref.id },
        data: {
          lastEventType: request.event,
          ...(replyText ? { lastEventKey: request.eventKey } : {}),
        },
      });
      return { success: true, updated: true, ts: ref.ts, channel: ref.channelId };
    }
    if (classifySlackError(updated.error, updated.status) !== 'message_gone')
      return failure(updated);
    logger.info('[Slack] Stored incident card is gone, posting a new one', {
      incidentId: input.incidentId,
      error: updated.error,
    });
    if (request.editOnly) {
      await store.deleteMany({ where: { id: ref.id } });
      return { success: true, skipped: true };
    }
    // Re-arm the claim on the existing row: this sender owns it, the old ts is dead.
    const rearmed = await store.updateMany({
      where: { id: ref.id, ts: ref.ts },
      data: { ts: null, channelId: null },
    });
    if (rearmed.count !== 1) return busy();
    return postAndRecord(store, ref.id, input, message, request);
  }

  if (plan.kind === 'skip') return { success: true, skipped: true };

  if (plan.kind === 'claim') {
    try {
      ref = await store.create({
        data: {
          incidentId: input.incidentId,
          channel: input.channel,
          workspaceId: install.workspaceId,
          lastEventType: request.event,
        },
      });
      return postAndRecord(store, ref.id, input, message, request);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // Lost the race: the winner is posting (or has posted). Retry later edits its card.
      ref = await store.findUnique({ where });
      plan = planLiveCardDelivery(ref, request);
      return plan.kind === 'update'
        ? busy('Slack incident card was just created; retrying as an edit')
        : busy();
    }
  }

  if (plan.kind === 'takeover' && ref) {
    const taken = await store.updateMany({
      where: { id: ref.id, ts: null, updatedAt: ref.updatedAt },
      data: { lastEventType: request.event },
    });
    if (taken.count === 1) return postAndRecord(store, ref.id, input, message, request);
  }
  return busy();
}

function busy(error = 'Another delivery is creating this Slack incident card'): LiveCardResult {
  // Not a 429: that would pause every Slack delivery. A plain retryable failure backs off this job only.
  return { success: false, error, errorCode: 'SLACK_CARD_CLAIM_BUSY' };
}

async function postAndRecord(
  store: CardStore,
  refId: string,
  input: Parameters<typeof deliverLiveIncidentCard>[0],
  message: Record<string, unknown>,
  request: SlackLiveCardRequest
): Promise<LiveCardResult> {
  const posted = await postSlackChannelMessage(
    input.install,
    input.postChannel,
    message,
    input.maxAttempts
  );
  if (!posted.ok || !posted.data.ts) {
    // Release the claim so the retry (or the next event) can post.
    await store.deleteMany({ where: { id: refId, ts: null } }).catch(() => undefined);
    return posted.ok ? { success: true, channel: posted.data.channel } : failure(posted);
  }
  await store.update({
    where: { id: refId },
    data: {
      ts: posted.data.ts,
      channelId: posted.data.channel ?? null,
      workspaceId: input.install.workspaceId,
      lastEventType: request.event,
      lastEventKey: request.eventKey,
    },
  });
  // Channel nudges (off unless configured); never blocks or fails the card delivery.
  await import('./nudges')
    .then(({ armSlackNudges }) => armSlackNudges(input.incidentId))
    .catch(error => logger.warn('[Slack] Could not arm nudges', { error: String(error) }));
  return { success: true, ts: posted.data.ts, channel: posted.data.channel };
}
