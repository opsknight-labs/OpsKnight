import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod/v4';
import prisma from '@/lib/prisma';
import { readSlackBotToken } from '@/app/api/slack/oauth/token-rotation';
import { logger } from '@/lib/logger';
import { addOperationalMetric } from '@/lib/metrics/operational/registry';
import { getSlackBotToken } from '@/lib/slack';
import { slackApiCall, type SlackApiResult } from '@/lib/war-room/providers/slack/client';
import {
  postMicrosoftTeamsChannelCard,
  replyInMicrosoftTeamsChannelThread,
  updateMicrosoftTeamsChannelCard,
  type TeamsDeliveryResult,
} from '@/lib/microsoft-teams/client';
import { chatBaseUrl, isSquireChatOpsEnabled } from './switches';
import {
  loadSquireIdentity,
  slackCanCustomizeSender,
  slackSquireBlocks,
  slackSquireSender,
  withTeamsSquireHeader,
  type SquireIdentity,
} from './identity';
import {
  appLink,
  chunks,
  escapeSlack,
  fitSlack,
  markdownToSlack,
  markdownToTeams,
  slackBlocksText,
} from './render';

/**
 * Posts (or edits in place) a Squire update in the incident's Slack or Teams war-room channel, under Squire's
 * own name where the workspace allows it. Callers (the proactive lane, verification checks) never wait on
 * chat delivery: this never throws, and an incident without a live war room is simply skipped.
 *
 * Where it posts: only the incident's own live (READY or CLOSING) war room per provider, after the same authority checks the
 * war-room card projection makes (ChatOps on and the Slack installation enabled; the Teams configuration and
 * destination enabled). Nothing falls back to a service's alert channel, so an incident whose war room is not
 * allowed gets no Squire post anywhere.
 *
 * How: SUMMARY and INVESTIGATION are posted once and then edited in place (SquireChannelMessage remembers the
 * message; an unchanged rendering is not re-sent). DIGEST and VERIFICATION are new replies threaded under the
 * INVESTIGATION (or SUMMARY) message, or top level when neither exists; an identical one is not posted twice.
 * The row is claimed with an optimistic check before any provider call, so concurrent publishes of one kind
 * cannot both post (a threaded kind that loses the race tries once more, so its update is not lost). A
 * provider rate limit backs that channel off, and a revoked or invalid installation backs off every channel of
 * that installation, in SquireChannelBackoff so every instance honours it; a post whose outcome is unknown is
 * left pending so it is not immediately repeated, and a post whose row could not be recorded is retried as a
 * row write, not re-posted.
 *
 * An update that failed or was rate limited is retried by a background job (SQUIRE_CHANNEL_RETRY) with the
 * queue's stored exponential backoff, for at most SQUIRE_CHANNEL_RETRY_ATTEMPTS tries; the job row records the
 * final failure. A Slack app missing a scope, not in the channel, or with a revoked token marks the war room
 * PERMISSION_ERROR with the reason, which the war-room card and health views show to administrators.
 */

export type SquireChannelUpdateKind = 'SUMMARY' | 'INVESTIGATION' | 'DIGEST' | 'VERIFICATION';

export interface SquireChannelUpdate {
  incidentId: string;
  kind: SquireChannelUpdateKind;
  /** Short heading, plain text. */
  title: string;
  /** The body, in the same Markdown Squire answers use (converted per provider). */
  markdown: string;
  /** SUMMARY and INVESTIGATION are edited in place; DIGEST and VERIFICATION post a new threaded reply. */
}

type Provider = 'SLACK' | 'TEAMS';
type Outcome =
  | 'posted'
  | 'edited'
  | 'unchanged'
  | 'busy'
  | 'rate_limited'
  | 'auth_failed'
  | 'not_allowed'
  | 'failed';

const KINDS: ReadonlySet<string> = new Set(['SUMMARY', 'INVESTIGATION', 'DIGEST', 'VERIFICATION']);
const THREADED: ReadonlySet<SquireChannelUpdateKind> = new Set(['DIGEST', 'VERIFICATION']);
const KIND_LABEL: Record<SquireChannelUpdateKind, string> = {
  SUMMARY: 'Incident summary',
  INVESTIGATION: 'Investigation',
  DIGEST: 'Digest',
  VERIFICATION: 'Verification',
};
const TITLE_MAX = 150;
const MARKDOWN_MAX = 12_000;
const SLACK_SECTION_MAX = 2_900;
const SLACK_SECTIONS = 4;
const TEAMS_BODY_MAX = 8_000;
/** A claimed first post younger than this is someone else's post in flight; older is abandoned. */
export const SQUIRE_PENDING_POST_MS = 2 * 60_000;
const DEFAULT_BACKOFF_MS = 30_000;
/** How long an installation whose token was revoked or refused is left alone. */
export const SQUIRE_AUTH_BACKOFF_MS = 30 * 60_000;
/** Pause before a threaded kind that lost the claim race tries once more. */
const THREADED_RETRY_MS = 1_500;
const RETRY_TASK = 'SQUIRE_CHANNEL_RETRY';
/** Tries of the background retry before the update is given up on (the job is then FAILED). */
export const SQUIRE_CHANNEL_RETRY_ATTEMPTS = 5;
/** Outcomes worth another try later; anything else is final or someone else's work. */
const RETRYABLE: ReadonlySet<Outcome> = new Set(['failed', 'rate_limited']);

/** Records a per-channel (or per-installation) "do not call before" time, shared by every instance. */
async function backOff(key: string, ms: number | undefined, reason: string) {
  const now = new Date();
  const until = new Date(
    now.getTime() + Math.min(Math.max(ms ?? DEFAULT_BACKOFF_MS, 1_000), SQUIRE_AUTH_BACKOFF_MS)
  );
  await settle(() =>
    prisma.squireChannelBackoff.upsert({
      where: { key },
      create: { key, until, reason },
      update: { until, reason },
    })
  );
  // Housekeeping only: expired pauses are ignored on read anyway.
  await settle(() => prisma.squireChannelBackoff.deleteMany({ where: { until: { lte: now } } }));
}

const SLACK_AUTH_ERRORS: ReadonlySet<string> = new Set([
  'token_revoked',
  'invalid_auth',
  'account_inactive',
  'not_authed',
  'token_expired',
  'missing_scope',
]);

/** A database write that must land: retried briefly, and false (never a throw) if it still fails. */
async function settle(write: () => Promise<unknown>): Promise<boolean> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await write();
      return true;
    } catch (error) {
      if (attempt >= 3) {
        logger.warn('[Squire] Channel message record not written', {
          error: error instanceof Error ? error.name : 'error',
        });
        return false;
      }
      await new Promise(resolve => setTimeout(resolve, 200 * attempt));
    }
  }
}

export async function __resetSquirePublishBackoffForTests() {
  await prisma.squireChannelBackoff.deleteMany();
}

/** What a provider call returned, reduced to what the claim logic needs. */
type SendResult =
  | { ok: true; channelId: string; messageId: string }
  | {
      ok: false;
      error: string;
      /** The edited message no longer exists, so a new one may be posted. */
      gone?: boolean;
      rateLimitedMs?: number;
      /** The installation's credentials were refused; nothing for it will work for a while. */
      authFailed?: boolean;
      /** The post may have happened; never repeat it right away. */
      ambiguous?: boolean;
      /** The app lacks a scope or channel membership: an administrator must fix it, so it is not retried. */
      attention?: string;
    };

interface StoredMessage {
  channelId: string;
  messageId: string;
}

/** One provider's war-room channel, with the calls a publish needs. */
interface ChannelTarget {
  provider: Provider;
  /** The war room, whose health carries a problem an administrator must fix. */
  roomId: string;
  /** The war-room channel id; also the backoff key. */
  channelId: string;
  /** The installation (Slack workspace, Teams tenant) whose credentials every call uses. */
  installation: string;
  /** Whether a stored message lives in this war room (an old generation's channel does not). */
  holds(message: StoredMessage): boolean;
  post(): Promise<SendResult>;
  reply(parent: StoredMessage): Promise<SendResult>;
  edit(message: StoredMessage): Promise<SendResult>;
  /** The rendered payload; its digest decides whether anything changed. */
  rendered: unknown;
}

export async function publishSquireUpdate(update: SquireChannelUpdate): Promise<void> {
  try {
    const outcomes = await publish(update);
    if (outcomes.some(outcome => RETRYABLE.has(outcome))) await scheduleRetry(update);
  } catch (error) {
    // Per-channel failures are counted in publish(); this only catches a failed lookup before them.
    logger.warn('[Squire] Channel update failed', {
      kind: update?.kind,
      error: error instanceof Error ? error.name : 'error',
    });
  }
}

function metric(provider: Provider, outcome: Outcome) {
  try {
    // Squire updates are war-room projections too; `squire_*` results keep them apart from the card.
    addOperationalMetric('opsknight_war_room_projection_total', 1, {
      provider: provider === 'TEAMS' ? 'MICROSOFT_TEAMS' : 'SLACK',
      result: `squire_${outcome}`,
    });
  } catch {
    // Metrics never break delivery.
  }
}

const retryPayloadSchema = z.object({
  task: z.literal(RETRY_TASK),
  retryKey: z.string(),
  incidentId: z.string().min(1),
  kind: z.enum(['SUMMARY', 'INVESTIGATION', 'DIGEST', 'VERIFICATION']),
  title: z.string(),
  markdown: z.string(),
});

/**
 * Queues a later try of an update that failed or was rate limited. One pending retry per update: a kind
 * edited in place keeps only its newest content, a threaded kind keeps each distinct reply.
 */
async function scheduleRetry(update: SquireChannelUpdate) {
  const retryKey = `${update.incidentId}:${update.kind}${
    THREADED.has(update.kind) ? `:${digest([update.title, update.markdown])}` : ''
  }`;
  const payload = {
    task: RETRY_TASK,
    retryKey,
    incidentId: update.incidentId,
    kind: update.kind,
    title: cleanTitle(update.title),
    markdown: (update.markdown ?? '').slice(0, MARKDOWN_MAX),
  };
  const refreshed = await prisma.backgroundJob.updateMany({
    where: {
      type: 'SCHEDULED_TASK',
      status: 'PENDING',
      AND: [
        { payload: { path: ['task'], equals: RETRY_TASK } },
        { payload: { path: ['retryKey'], equals: retryKey } },
      ],
    },
    data: { payload },
  });
  if (refreshed.count === 0)
    await prisma.backgroundJob.create({
      data: {
        type: 'SCHEDULED_TASK',
        status: 'PENDING',
        scheduledAt: new Date(Date.now() + DEFAULT_BACKOFF_MS),
        payload,
        maxAttempts: SQUIRE_CHANNEL_RETRY_ATTEMPTS,
      },
    });
}

/**
 * Runs one queued retry (BackgroundJob SCHEDULED_TASK `SQUIRE_CHANNEL_RETRY`). Throws while a channel still
 * fails, so the queue reschedules it with its backoff until the attempts run out and the job is FAILED.
 */
export async function processSquireChannelRetry(payload: unknown): Promise<void> {
  const parsed = retryPayloadSchema.safeParse(payload);
  if (!parsed.success) return;
  const outcomes = await publish(parsed.data);
  const pending = outcomes.filter(outcome => RETRYABLE.has(outcome));
  if (pending.length)
    throw new Error(`Squire channel update not delivered (${pending.join(', ')})`);
}

async function publish(update: SquireChannelUpdate): Promise<Outcome[]> {
  if (!update || typeof update.incidentId !== 'string' || !update.incidentId) return [];
  if (!KINDS.has(update.kind)) return [];
  if (!(await isSquireChatOpsEnabled())) return [];
  const rooms = await prisma.incidentWarRoom.findMany({
    where: {
      incidentId: update.incidentId,
      // The states in which the war-room card itself may still be projected.
      state: { in: ['READY', 'CLOSING'] },
      provider: { in: ['SLACK', 'MICROSOFT_TEAMS'] },
      providerChannelId: { not: null },
    },
    orderBy: { generation: 'desc' },
    take: 4,
  });
  if (rooms.length === 0) return [];
  const incident = await prisma.incident.findUnique({
    where: { id: update.incidentId },
    select: { id: true, serviceId: true },
  });
  if (!incident) return [];
  const identity = await loadSquireIdentity();
  const baseUrl = chatBaseUrl();
  const seen = new Set<string>();
  const outcomes: Outcome[] = [];
  for (const room of rooms) {
    // Only the newest generation per provider is the live war room.
    if (seen.has(room.provider)) continue;
    seen.add(room.provider);
    const provider: Provider = room.provider === 'SLACK' ? 'SLACK' : 'TEAMS';
    let outcome: Outcome;
    try {
      const target =
        provider === 'SLACK'
          ? await slackTarget(room, incident.serviceId, update, identity, baseUrl)
          : await teamsTarget(room, update, identity, baseUrl);
      outcome = target ? await deliver(update, target) : 'not_allowed';
      // A concurrent publish of the same threaded kind held the row: once it is through, this distinct
      // update still needs its own reply (an identical one is then 'unchanged').
      if (target && outcome === 'busy' && THREADED.has(update.kind)) {
        await new Promise(resolve => setTimeout(resolve, THREADED_RETRY_MS));
        outcome = await deliver(update, target);
      }
    } catch (error) {
      logger.warn('[Squire] Channel update failed', {
        provider,
        kind: update.kind,
        error: error instanceof Error ? error.name : 'error',
      });
      outcome = 'failed';
    }
    metric(provider, outcome);
    if (outcome === 'failed' || outcome === 'rate_limited')
      logger.info('[Squire] Channel update not delivered', {
        provider,
        kind: update.kind,
        incidentId: update.incidentId,
        outcome,
      });
    outcomes.push(outcome);
  }
  return outcomes;
}

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** The claim / call / record cycle shared by both providers. */
async function deliver(update: SquireChannelUpdate, target: ChannelTarget): Promise<Outcome> {
  const hash = digest(target.rendered);
  const key = {
    incidentId: update.incidentId,
    provider: target.provider,
    kind: update.kind,
  };
  const existing = await prisma.squireChannelMessage.findUnique({
    where: { incidentId_provider_kind: key },
  });
  if (existing?.messageId && existing.contentHash === hash && target.holds(existing))
    return 'unchanged';
  if (
    existing &&
    !existing.messageId &&
    Date.now() - existing.updatedAt.getTime() < SQUIRE_PENDING_POST_MS
  )
    return 'busy';
  const backoffKey = `${target.provider}:${target.channelId}`;
  const installationKey = `${target.provider}:installation:${target.installation}`;
  const blocked = await prisma.squireChannelBackoff.findMany({
    where: { key: { in: [installationKey, backoffKey] }, until: { gt: new Date() } },
    select: { key: true },
  });
  if (blocked.some(row => row.key === installationKey)) return 'auth_failed';
  if (blocked.length) return 'rate_limited';

  // Claim: a new row, or the existing one unchanged since it was read. Losing either race means another
  // publish of this kind is in flight; it wins and this one is skipped rather than posted twice.
  let row: { id: string };
  if (!existing) {
    try {
      row = await prisma.squireChannelMessage.create({
        data: { ...key, channelId: target.channelId, messageId: '', contentHash: hash },
        select: { id: true },
      });
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code === 'P2002') return 'busy';
      throw error;
    }
  } else {
    const claimed = await prisma.squireChannelMessage.updateMany({
      where: { id: existing.id, updatedAt: existing.updatedAt },
      data: { contentHash: hash },
    });
    if (claimed.count !== 1) return 'busy';
    row = existing;
  }

  const editable =
    !THREADED.has(update.kind) && existing?.messageId && target.holds(existing) ? existing : null;
  // A provider call that throws may still have reached the provider: its outcome is unknown.
  const send = (call: () => Promise<SendResult>): Promise<SendResult> =>
    call().catch(error => ({
      ok: false as const,
      error: error instanceof Error ? error.name : 'error',
      ambiguous: true,
    }));
  let result: SendResult;
  let posted = true;
  if (editable) {
    posted = false;
    result = await send(() => target.edit(editable));
    if (!result.ok && result.gone) {
      posted = true;
      result = await send(() => target.post());
    }
  } else if (THREADED.has(update.kind)) {
    const parent = await threadParent(update.incidentId, target).catch(() => null);
    result = await send(() => (parent ? target.reply(parent) : target.post()));
  } else {
    result = await send(() => target.post());
  }

  if (result.ok) {
    const sent = result;
    // The message exists now: losing its id would re-post it once the pending window passes, so the
    // row write is retried rather than given up on.
    const recorded = await settle(() =>
      prisma.squireChannelMessage.update({
        where: { id: row.id },
        data: { channelId: sent.channelId, messageId: sent.messageId, contentHash: hash },
      })
    );
    if (!recorded)
      logger.error('[Squire] Channel message sent but not recorded', {
        provider: target.provider,
        kind: update.kind,
        incidentId: update.incidentId,
      });
    return posted ? 'posted' : 'edited';
  }
  if (result.rateLimitedMs !== undefined)
    await backOff(backoffKey, result.rateLimitedMs, 'rate_limited');
  if (result.authFailed) await backOff(installationKey, SQUIRE_AUTH_BACKOFF_MS, result.error);
  if (result.attention) {
    const reason = result.attention;
    await settle(() =>
      prisma.incidentWarRoom.updateMany({
        where: { id: target.roomId },
        data: {
          health: 'PERMISSION_ERROR',
          lastErrorCode: `SQUIRE_${result.error.toUpperCase()}`,
          lastError: reason,
        },
      })
    );
  }
  if (result.ambiguous && posted) {
    // The message may exist without its id: stay pending so nothing re-posts it for a while.
    await settle(() =>
      prisma.squireChannelMessage.update({
        where: { id: row.id },
        data: { messageId: '', contentHash: hash },
      })
    );
  } else if (!existing) {
    await settle(() =>
      prisma.squireChannelMessage.deleteMany({ where: { id: row.id, messageId: '' } })
    );
  } else {
    // Nothing changed in the channel: restore the previous digest so the next publish tries again.
    await settle(() =>
      prisma.squireChannelMessage.updateMany({
        where: { id: row.id, contentHash: hash },
        data: { contentHash: existing.contentHash },
      })
    );
  }
  logger.warn('[Squire] Channel update rejected by provider', {
    provider: target.provider,
    kind: update.kind,
    error: result.error.slice(0, 200),
  });
  return result.authFailed
    ? 'auth_failed'
    : result.rateLimitedMs !== undefined
      ? 'rate_limited'
      : result.attention
        ? 'not_allowed'
        : 'failed';
}

/** The message a digest or verification replies under: the investigation, else the summary. */
async function threadParent(
  incidentId: string,
  target: ChannelTarget
): Promise<StoredMessage | null> {
  const candidates = await prisma.squireChannelMessage.findMany({
    where: {
      incidentId,
      provider: target.provider,
      kind: { in: ['INVESTIGATION', 'SUMMARY'] },
      messageId: { not: '' },
    },
    select: { kind: true, channelId: true, messageId: true },
  });
  const live = candidates.filter(message => target.holds(message));
  return (
    live.find(message => message.kind === 'INVESTIGATION') ??
    live.find(message => message.kind === 'SUMMARY') ??
    null
  );
}

const cleanTitle = (title: string) =>
  (title ?? '').replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX) || 'Squire update';

function incidentLink(incidentId: string, baseUrl: string): string | null {
  return appLink(`/incidents/${encodeURIComponent(incidentId)}`, baseUrl);
}

/** Block Kit for one update (pure; the identity header is added by the caller's sender choice). */
export function renderSlackSquireUpdate(
  update: SquireChannelUpdate,
  identity: SquireIdentity,
  baseUrl: string,
  canCustomize: boolean
): { text: string; blocks: Record<string, unknown>[] } {
  const title = cleanTitle(update.title);
  const body = markdownToSlack(
    (update.markdown ?? '').slice(0, MARKDOWN_MAX).trim() || '_No details yet._',
    baseUrl
  );
  const link = incidentLink(update.incidentId, baseUrl);
  const blocks: Record<string, unknown>[] = [
    { type: 'section', text: { type: 'mrkdwn', text: `*${escapeSlack(title)}*` } },
    ...chunks(body, SLACK_SECTION_MAX, SLACK_SECTIONS).map(part => ({
      type: 'section',
      text: { type: 'mrkdwn', text: fitSlack(part) },
    })),
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `${escapeSlack(identity.name)} · ${KIND_LABEL[update.kind]} · posted automatically${
            link ? ` · <${link}|Open incident>` : ''
          }`,
        },
      ],
    },
  ];
  return {
    text: escapeSlack(`${identity.name}: ${title}`),
    blocks: slackSquireBlocks(blocks, identity, canCustomize),
  };
}

/** Adaptive Card for one update, with the Squire header (Teams always shows the app as sender). */
export function renderTeamsSquireUpdate(
  update: SquireChannelUpdate,
  identity: SquireIdentity,
  baseUrl: string
): Record<string, unknown> {
  const link = incidentLink(update.incidentId, baseUrl);
  return withTeamsSquireHeader(
    {
      type: 'AdaptiveCard',
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
      version: '1.5',
      body: [
        {
          type: 'TextBlock',
          wrap: true,
          weight: 'Bolder',
          text: markdownToTeams(cleanTitle(update.title), baseUrl),
        },
        {
          type: 'TextBlock',
          wrap: true,
          text: markdownToTeams(
            ((update.markdown ?? '').trim() || '_No details yet._').slice(0, TEAMS_BODY_MAX),
            baseUrl
          ),
        },
        {
          type: 'TextBlock',
          wrap: true,
          isSubtle: true,
          size: 'Small',
          text: `${identity.name} · ${KIND_LABEL[update.kind]} · posted automatically`,
        },
      ],
      ...(link ? { actions: [{ type: 'Action.OpenUrl', title: 'Open incident', url: link }] } : {}),
    },
    identity
  );
}

type WarRoom = {
  id: string;
  destinationId: string | null;
  providerTenantId: string | null;
  providerContainerId: string | null;
  providerChannelId: string | null;
};

export const SLACK_GONE: ReadonlySet<string> = new Set([
  'message_not_found',
  'cant_update_message',
  'edit_window_closed',
]);

function slackResult(result: SlackApiResult, channelId: string): SendResult {
  if (result.ok) {
    const ts = result.ts ?? result.message?.ts;
    return ts
      ? { ok: true, channelId, messageId: ts }
      : { ok: false, error: 'missing_ts', ambiguous: true };
  }
  const error = result.error ?? 'error';
  if (result.httpStatus === 429 || error === 'ratelimited' || /HTTP 429/.test(error))
    return { ok: false, error: 'ratelimited', rateLimitedMs: DEFAULT_BACKOFF_MS };
  return {
    ok: false,
    error,
    gone: SLACK_GONE.has(error),
    authFailed: SLACK_AUTH_ERRORS.has(error),
    ambiguous: Boolean(result.sideEffectAmbiguous),
    attention: slackAttention(error, (result as { needed?: unknown }).needed),
  };
}

/** What an administrator must fix for Squire to post, for the errors only they can fix. */
function slackAttention(error: string, needed: unknown): string | undefined {
  if (error === 'missing_scope') {
    // Slack names the missing scope in `needed` (for example "chat:write"); anything else is not shown.
    const scope = typeof needed === 'string' && /^[a-z:._,-]{1,100}$/.test(needed) ? needed : null;
    return `Squire cannot post in this channel: the Slack app is missing the ${
      scope ? `${scope} scope` : 'scope it needs'
    }. Reinstall the Slack app to grant it.`;
  }
  if (error === 'not_in_channel')
    return 'Squire cannot post in this channel: the Slack app is not a member. Invite it to the channel.';
  if (error === 'token_revoked')
    return 'Squire cannot post in this channel: the Slack app token was revoked. Reinstall the Slack app.';
  return undefined;
}

/** Slack refused the blocks themselves; the same message as text alone still goes through. */
const blocksRefused = (result: SlackApiResult) =>
  !result.ok &&
  ['invalid_blocks', 'invalid_blocks_format', 'msg_too_long'].includes(result.error ?? '');

/** The Slack war room, if the same authority the war-room card needs still holds. */
async function slackTarget(
  room: WarRoom,
  serviceId: string,
  update: SquireChannelUpdate,
  identity: SquireIdentity,
  baseUrl: string
): Promise<ChannelTarget | null> {
  const channel = room.providerChannelId;
  if (!channel || !room.providerTenantId) return null;
  const [config, integration] = await Promise.all([
    prisma.chatOpsConfig.findUnique({ where: { id: 'default' }, select: { enabled: true } }),
    prisma.slackIntegration.findFirst({
      where: { workspaceId: room.providerTenantId, enabled: true },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, botToken: true, refreshToken: true, tokenExpiresAt: true },
    }),
  ]);
  if (!config?.enabled || !integration) return null;
  // The war room's own installation: with several workspaces, the service's token may be another one's.
  const token = integration.botToken
    ? await readSlackBotToken(integration).catch(() => null)
    : await getSlackBotToken(serviceId);
  if (!token) return null;
  const canCustomize = await slackCanCustomizeSender(serviceId);
  const message = renderSlackSquireUpdate(update, identity, baseUrl, canCustomize);
  const textOnly = { text: slackBlocksText(message.blocks, message.text), blocks: [] };
  // invalid_blocks means nothing was posted, so resending as text alone cannot duplicate.
  const call = async (method: string, body: Record<string, unknown>) => {
    const result = await slackApiCall(method, token, { ...body, ...message });
    return blocksRefused(result) ? slackApiCall(method, token, { ...body, ...textOnly }) : result;
  };
  const post = (threadTs?: string) =>
    call('chat.postMessage', {
      channel,
      ...slackSquireSender(identity, canCustomize),
      ...(threadTs ? { thread_ts: threadTs } : {}),
      unfurl_links: false,
      unfurl_media: false,
    }).then(result => slackResult(result, channel));
  return {
    provider: 'SLACK',
    roomId: room.id,
    channelId: channel,
    installation: room.providerTenantId,
    rendered: { ...message, sender: slackSquireSender(identity, canCustomize) },
    holds: stored => stored.channelId === channel,
    post: () => post(),
    reply: parent => post(parent.messageId),
    edit: stored =>
      call('chat.update', { channel, ts: stored.messageId }).then(result =>
        slackResult(result.ok ? { ...result, ts: stored.messageId } : result, channel)
      ),
  };
}

function teamsResult(result: TeamsDeliveryResult, fallbackConversation: string): SendResult {
  if (result.success) {
    return result.providerMessageId
      ? {
          ok: true,
          channelId: result.conversationId ?? fallbackConversation,
          messageId: result.providerMessageId,
        }
      : { ok: false, error: 'missing_id', ambiguous: true };
  }
  if (result.errorCode === 'RATE_LIMITED' || result.statusCode === 429)
    return { ok: false, error: 'rate_limited', rateLimitedMs: result.retryAfterMs };
  return {
    ok: false,
    error: result.errorCode ?? result.error,
    gone: result.errorCode === 'MESSAGE_NOT_FOUND',
    // A 403 can be one message the bot may not edit; only a refused token or credential is installation-wide.
    authFailed: result.errorCode === 'GRAPH_TOKEN_FAILED' || result.statusCode === 401,
    ambiguous: result.errorCode === 'AMBIGUOUS_SIDE_EFFECT',
  };
}

/**
 * The Teams war room, under the same configuration and destination checks as its card. A Teams message is
 * stored with its bot conversation id (`<channel>;messageid=<root>`) as `channelId`, which both edits and
 * threaded replies need.
 */
async function teamsTarget(
  room: WarRoom,
  update: SquireChannelUpdate,
  identity: SquireIdentity,
  baseUrl: string
): Promise<ChannelTarget | null> {
  const channel = room.providerChannelId;
  const tenantId = room.providerTenantId;
  const teamId = room.providerContainerId;
  if (!channel || !tenantId || !teamId || !room.destinationId) return null;
  const [config, destination] = await Promise.all([
    prisma.microsoftTeamsConfig.findFirst({
      where: { enabled: true, warRoomsEnabled: true },
      select: { id: true },
    }),
    prisma.microsoftTeamsDestination.findUnique({
      where: { id: room.destinationId },
      select: { enabled: true, warRoomEnabled: true, tenantId: true, teamId: true },
    }),
  ]);
  if (!config || !destination?.enabled || !destination.warRoomEnabled) return null;
  if (destination.tenantId !== tenantId || destination.teamId !== teamId) return null;
  const card = renderTeamsSquireUpdate(update, identity, baseUrl);
  return {
    provider: 'TEAMS',
    roomId: room.id,
    channelId: channel,
    installation: tenantId,
    rendered: card,
    holds: stored => stored.channelId.split(';')[0] === channel,
    post: async () =>
      teamsResult(
        await postMicrosoftTeamsChannelCard({
          tenantId,
          teamId,
          channelId: channel,
          incidentId: update.incidentId,
          card,
        }),
        channel
      ),
    reply: async parent =>
      teamsResult(
        await replyInMicrosoftTeamsChannelThread({
          tenantId,
          teamId,
          conversationId: parent.channelId,
          replyToId: parent.messageId,
          card,
        }),
        parent.channelId
      ),
    edit: async stored =>
      teamsResult(
        await updateMicrosoftTeamsChannelCard({
          tenantId,
          teamId,
          channelId: channel,
          conversationId: stored.channelId,
          messageId: stored.messageId,
          incidentId: update.incidentId,
          card,
        }),
        stored.channelId
      ),
  };
}
