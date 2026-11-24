import { beforeEach, describe, expect, it, vi } from 'vitest';

// Squire in the incident channel: its identity, channel updates (publishSquireUpdate) and `investigate`.

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => null) }));
vi.mock('@/lib/auth', () => ({ getAuthOptions: vi.fn(async () => ({})) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/slack', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/slack')>()),
  getSlackBotToken: vi.fn(async () => 'xoxb-test'),
}));
// Slack users.info answers with the verified email of each Slack account; any other retried call
// (chat.update) goes to the stubbed fetch like a single-attempt call does.
const slackEmails = vi.hoisted(() => new Map<string, string>());
vi.mock('@/lib/retry', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/retry')>()),
  retryFetch: vi.fn(async (url: string, init?: RequestInit) => {
    if (!String(url).includes('users.info')) return fetch(url, init);
    const email = slackEmails.get(new URL(url).searchParams.get('user') ?? '');
    return {
      json: async () =>
        email
          ? { ok: true, user: { team_id: 'T_WORKSPACE', profile: { email } } }
          : { ok: false, error: 'user_not_found' },
    };
  }),
}));
// Teams transport: recorded, never sent.
const teams = vi.hoisted(() => ({
  post: vi.fn(),
  update: vi.fn(),
  thread: vi.fn(),
  reply: vi.fn(),
}));
vi.mock('@/lib/microsoft-teams/client', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/microsoft-teams/client')>()),
  postMicrosoftTeamsChannelCard: teams.post,
  updateMicrosoftTeamsChannelCard: teams.update,
  replyInMicrosoftTeamsChannelThread: teams.thread,
  replyToMicrosoftTeamsActivity: teams.reply,
}));

import { encrypt } from '@/lib/encryption';
import prisma from '@/lib/prisma';
import { processChatOpsIntent } from '@/lib/chatops/intents';
import { handleSlashCommand } from '@/lib/chatops/slash-commands';
import {
  SQUIRE_CHAT_NO_INCIDENT_ACCESS,
  SQUIRE_CHAT_NOT_LINKED,
} from '@/lib/chatops/squire/handler';
import {
  __resetSquirePublishBackoffForTests,
  processSquireChannelRetry,
  publishSquireUpdate,
  SQUIRE_CHANNEL_RETRY_ATTEMPTS,
} from '@/lib/chatops/squire/publish';
import { markJobFailed } from '@/lib/jobs/queue';
import { deliverSlackSquireReply } from '@/lib/chatops/squire/slack';
import { enqueueSlackSquireMention } from '@/lib/chatops/squire/slack-events';
import { answerTeamsSquireMention, deliverTeamsSquireReply } from '@/lib/chatops/squire/teams';
import {
  createTestIncident,
  createTestService,
  createTestTeam,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

const WORKSPACE = 'T_WORKSPACE';
const CHANNEL = 'C_WARROOM';
const TENANT = 'tenant-1';
const TEAM = 'team-1';
const TEAMS_CHANNEL = '19:warroom@thread.tacv2';
const BASE = 'https://ops.example.com';

type SlackCall = { method: string; body: Record<string, unknown> };
const slackCalls: SlackCall[] = [];
/** Per-method canned Slack responses for the next call (otherwise ok). */
const slackOverrides = new Map<string, Record<string, unknown>>();
let tsCounter = 0;

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
  vi.stubEnv('NEXT_PUBLIC_APP_URL', BASE);
  await __resetSquirePublishBackoffForTests();
  slackEmails.clear();
  slackCalls.length = 0;
  slackOverrides.clear();
  tsCounter = 0;
  for (const fn of Object.values(teams)) fn.mockReset();
  teams.post.mockResolvedValue({
    success: true,
    providerMessageId: 'act-1',
    conversationId: `${TEAMS_CHANNEL};messageid=act-1`,
  });
  teams.update.mockResolvedValue({ success: true, providerMessageId: 'act-1' });
  teams.thread.mockImplementation(async (args: { conversationId: string }) => ({
    success: true,
    providerMessageId: 'reply-1',
    conversationId: args.conversationId,
  }));
  teams.reply.mockResolvedValue({ success: true, providerMessageId: 'placeholder-1' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = String(url).split('/api/')[1]?.split('?')[0] ?? '';
      // The application's own log shipping (the dev encryption-key warning) is not a Slack call.
      if (method.startsWith('logs/')) return new Response('{}', { status: 200 });
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      slackCalls.push({ method, body });
      const override = slackOverrides.get(method);
      if (override) {
        slackOverrides.delete(method);
        return new Response(JSON.stringify(override), { status: 200 });
      }
      const ts =
        method === 'chat.update' ? body.ts : `1700000000.${String(++tsCounter).padStart(6, '0')}`;
      return new Response(JSON.stringify({ ok: true, ts, messages: [] }), { status: 200 });
    })
  );
});

const calls = (method: string) => slackCalls.filter(call => call.method === method);

async function world(
  options: { scopes?: string[]; chatOps?: boolean; squireName?: string; room?: boolean } = {}
) {
  await db.aiSettings.create({
    data: {
      id: 'default',
      enabled: false,
      squireEnabled: true,
      squireChatOpsEnabled: options.chatOps ?? true,
      squireName: options.squireName ?? 'Squire',
    },
  });
  await db.chatOpsConfig.create({ data: { id: 'default', enabled: true } });
  const team = await createTestTeam('Checkout');
  const owner = await createTestUser({
    role: 'RESPONDER',
    name: 'Olive',
    email: 'olive@example.com',
  });
  await db.teamMember.create({ data: { userId: owner.id, teamId: team.id, role: 'MEMBER' } });
  const outsider = await createTestUser({ role: 'USER', name: 'Otto', email: 'otto@example.com' });
  const integration = await db.slackIntegration.create({
    data: {
      workspaceId: WORKSPACE,
      botToken: await encrypt('xoxb-test'),
      enabled: true,
      installedBy: owner.id,
      scopes: options.scopes ?? ['chat:write', 'app_mentions:read'],
    },
  });
  const service = await createTestService('Checkout API', team.id, {
    slackIntegrationId: integration.id,
  });
  const incident = await createTestIncident('Checkout errors', service.id, {
    slackChannelId: CHANNEL,
    slackWorkspaceId: WORKSPACE,
  });
  if (options.room ?? true)
    await db.incidentWarRoom.create({
      data: {
        incidentId: incident.id,
        provider: 'SLACK',
        state: 'READY',
        providerTenantId: WORKSPACE,
        providerChannelId: CHANNEL,
      },
    });
  slackEmails.set('U_OWNER', 'olive@example.com');
  slackEmails.set('U_OUT', 'otto@example.com');
  return { owner, outsider, service, incident };
}

async function teamsRoom(incidentId: string, serviceId: string) {
  await db.microsoftTeamsConfig.create({
    data: { clientId: 'client', clientSecret: 'sealed', enabled: true, warRoomsEnabled: true },
  });
  const destination = await db.microsoftTeamsDestination.create({
    data: {
      serviceId,
      tenantId: TENANT,
      teamId: TEAM,
      channelId: 'general',
      enabled: true,
      warRoomEnabled: true,
    },
  });
  await db.incidentWarRoom.create({
    data: {
      incidentId,
      provider: 'MICROSOFT_TEAMS',
      state: 'READY',
      destinationId: destination.id,
      providerTenantId: TENANT,
      providerContainerId: TEAM,
      providerChannelId: TEAMS_CHANNEL,
    },
  });
}

/** Queue an event as the events route does, run the worker, and return Slack's calls for it. */
async function mention(
  user: string,
  text: string,
  type: 'app_mention' | 'message' = 'app_mention'
) {
  const queued = await enqueueSlackSquireMention({
    team_id: WORKSPACE,
    event_id: `Ev${Math.random()}`,
    event: { type, user, text, channel: CHANNEL, ts: '1700000000.000100' },
  });
  if (!queued) return null;
  const intent = await db.chatOpsIntent.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
  await processChatOpsIntent(intent.id);
  return slackCalls;
}

/** The final answer: the last update of the placeholder, or the last post. */
function finalAnswer(): Record<string, unknown> {
  const last = slackCalls
    .filter(c => c.method === 'chat.update' || c.method === 'chat.postMessage')
    .at(-1);
  expect(last).toBeDefined();
  return last!.body;
}

const blockTexts = (body: Record<string, unknown>) => JSON.stringify(body.blocks ?? []);

describe('Squire identity in Slack', () => {
  it('posts as the configured Squire name and avatar when chat:write.customize was granted', async () => {
    await world({ scopes: ['chat:write', 'chat:write.customize'], squireName: 'Sage' });
    await mention('U_OWNER', '<@U0BOT> what is happening?');
    const post = calls('chat.postMessage')[0].body;
    expect(post.username).toBe('Sage');
    expect(post.icon_url).toBe(`${BASE}/squire/squire-avatar.png`);
    expect(blockTexts(post)).not.toContain('squire_identity');
    // Edits keep the sender they were posted with; the answer carries no header either.
    expect(blockTexts(finalAnswer())).not.toContain('squire_identity');
    expect(finalAnswer().username).toBeUndefined();
  });

  it('leads every Squire message with a header when the scope is missing', async () => {
    await world({ squireName: 'Sage' });
    await mention('U_OWNER', '<@U0BOT> what is happening?');
    const post = calls('chat.postMessage')[0].body;
    expect(post.username).toBeUndefined();
    expect(post.icon_url).toBeUndefined();
    const header = (post.blocks as Array<Record<string, unknown>>)[0];
    expect(header.block_id).toBe('squire_identity');
    expect(JSON.stringify(header)).toContain('*Sage* · OpsKnight assistant');
    expect(JSON.stringify(header)).toContain(`${BASE}/squire/squire-avatar.png`);
    expect((finalAnswer().blocks as Array<{ block_id?: string }>)[0].block_id).toBe(
      'squire_identity'
    );
  });
});

describe('Squire identity in Teams', () => {
  it('starts each answer card with the Squire header (Teams cannot change the sender)', async () => {
    const { incident, service } = await world({ squireName: 'Sage' });
    await teamsRoom(incident.id, service.id);
    const reply = await answerTeamsSquireMention({
      __kind: 'SQUIRE_MENTION',
      tenantId: TENANT,
      serviceUrl: 'https://smba.trafficmanager.net/emea/',
      conversationId: `${TEAMS_CHANNEL};messageid=1`,
      activityId: '1',
      channelIds: [TEAMS_CHANNEL],
      fromId: '29:unlinked',
      aadObjectId: null,
      fromName: 'Someone',
      text: '<at>OpsKnight</at> investigate',
    });
    const body = reply.card.body as Array<Record<string, unknown>>;
    expect(body[0].id).toBe('squire_identity');
    expect(JSON.stringify(body[0])).toContain('**Sage** · OpsKnight assistant');
    expect(JSON.stringify(reply.card)).toContain(SQUIRE_CHAT_NOT_LINKED);
    // An unlinked person gets no progress message.
    expect(teams.reply).not.toHaveBeenCalled();
  });
});

const update = (
  incidentId: string,
  kind: 'SUMMARY' | 'INVESTIGATION' | 'DIGEST' | 'VERIFICATION',
  markdown = 'Errors began at **10:02** after [deploy](/changes/c1).'
) => ({
  incidentId,
  kind,
  title: `${kind} for checkout`,
  markdown,
});

describe('publishSquireUpdate', () => {
  it('posts a summary once, edits it in place, and skips an unchanged one', async () => {
    const { incident } = await world();
    await publishSquireUpdate(update(incident.id, 'SUMMARY'));
    expect(calls('chat.postMessage')).toHaveLength(1);
    const first = calls('chat.postMessage')[0].body;
    expect(first.channel).toBe(CHANNEL);
    expect(blockTexts(first)).toContain(`<${BASE}/changes/c1|deploy>`);
    expect(blockTexts(first)).toContain('squire_identity');
    const row = await db.squireChannelMessage.findFirstOrThrow();
    expect(row).toMatchObject({ provider: 'SLACK', kind: 'SUMMARY', channelId: CHANNEL });

    await publishSquireUpdate(update(incident.id, 'SUMMARY'));
    expect(slackCalls).toHaveLength(1);

    await publishSquireUpdate(update(incident.id, 'SUMMARY', 'Now recovering.'));
    expect(calls('chat.postMessage')).toHaveLength(1);
    expect(calls('chat.update')).toHaveLength(1);
    expect(calls('chat.update')[0].body.ts).toBe(row.messageId);
    expect(await db.squireChannelMessage.count()).toBe(1);
  });

  it('posts a new summary when the stored message was deleted', async () => {
    const { incident } = await world();
    await publishSquireUpdate(update(incident.id, 'SUMMARY'));
    slackOverrides.set('chat.update', { ok: false, error: 'message_not_found' });
    await publishSquireUpdate(update(incident.id, 'SUMMARY', 'Changed.'));
    expect(calls('chat.postMessage')).toHaveLength(2);
    const row = await db.squireChannelMessage.findFirstOrThrow();
    expect(row.messageId).toBe('1700000000.000002');
  });

  it('threads digests and verifications under the investigation, never twice for the same text', async () => {
    const { incident } = await world();
    await publishSquireUpdate(update(incident.id, 'SUMMARY'));
    await publishSquireUpdate(update(incident.id, 'INVESTIGATION'));
    const investigation = await db.squireChannelMessage.findFirstOrThrow({
      where: { kind: 'INVESTIGATION' },
    });
    await publishSquireUpdate(update(incident.id, 'DIGEST', 'Digest one'));
    await publishSquireUpdate(update(incident.id, 'DIGEST', 'Digest one'));
    await publishSquireUpdate(update(incident.id, 'VERIFICATION', 'Fix verified'));
    const posts = calls('chat.postMessage');
    expect(posts).toHaveLength(4);
    expect(posts[2].body.thread_ts).toBe(investigation.messageId);
    expect(posts[3].body.thread_ts).toBe(investigation.messageId);
    expect(posts[0].body.thread_ts).toBeUndefined();
  });

  it('posts a digest top-level when nothing to thread under exists', async () => {
    const { incident } = await world();
    await publishSquireUpdate(update(incident.id, 'DIGEST'));
    expect(calls('chat.postMessage')[0].body.thread_ts).toBeUndefined();
  });

  it('never posts for an incident without a permitted war room (no fallback channel)', async () => {
    const { incident } = await world({ room: false });
    await db.incident.update({ where: { id: incident.id }, data: { visibility: 'PRIVATE' } });
    await publishSquireUpdate(update(incident.id, 'SUMMARY'));
    // A room that is not live, or whose authority was revoked, is not posted to either.
    await db.incidentWarRoom.create({
      data: {
        incidentId: incident.id,
        provider: 'SLACK',
        state: 'FAILED',
        providerTenantId: WORKSPACE,
        providerChannelId: CHANNEL,
      },
    });
    await publishSquireUpdate(update(incident.id, 'SUMMARY'));
    expect(slackCalls).toHaveLength(0);
    expect(await db.squireChannelMessage.count()).toBe(0);
  });

  it('is a no-op when chat is not configured', async () => {
    const off = await world({ chatOps: false });
    await publishSquireUpdate(update(off.incident.id, 'SUMMARY'));
    expect(slackCalls).toHaveLength(0);

    await db.aiSettings.update({ where: { id: 'default' }, data: { squireChatOpsEnabled: true } });
    await db.chatOpsConfig.update({ where: { id: 'default' }, data: { enabled: false } });
    await publishSquireUpdate(update(off.incident.id, 'SUMMARY'));
    expect(slackCalls).toHaveLength(0);
    // Unknown incidents and malformed updates are ignored, never thrown.
    await expect(
      publishSquireUpdate({ incidentId: 'missing', kind: 'SUMMARY', title: 't', markdown: 'm' })
    ).resolves.toBeUndefined();
    await expect(
      publishSquireUpdate({
        incidentId: off.incident.id,
        kind: 'NOPE' as never,
        title: '',
        markdown: '',
      })
    ).resolves.toBeUndefined();
  });

  it('backs off a rate-limited channel and keeps the update for the next try', async () => {
    const { incident } = await world();
    slackOverrides.set('chat.postMessage', { ok: false, error: 'ratelimited' });
    await publishSquireUpdate(update(incident.id, 'SUMMARY'));
    expect(await db.squireChannelMessage.count()).toBe(0);
    await publishSquireUpdate(update(incident.id, 'SUMMARY'));
    expect(calls('chat.postMessage')).toHaveLength(1);
    // The backoff is a row, so every instance honours it.
    expect(
      await db.squireChannelBackoff.findUniqueOrThrow({ where: { key: `SLACK:${CHANNEL}` } })
    ).toMatchObject({ reason: 'rate_limited' });
    await __resetSquirePublishBackoffForTests();
    await publishSquireUpdate(update(incident.id, 'SUMMARY'));
    expect(calls('chat.postMessage')).toHaveLength(2);
    expect(await db.squireChannelMessage.count()).toBe(1);
  });

  it('lets only one of two concurrent first posts through', async () => {
    const { incident } = await world();
    await Promise.all([
      publishSquireUpdate(update(incident.id, 'SUMMARY', 'A')),
      publishSquireUpdate(update(incident.id, 'SUMMARY', 'B')),
    ]);
    expect(calls('chat.postMessage')).toHaveLength(1);
  });

  it('posts, edits and threads in the Teams war room with the Squire header', async () => {
    const { incident, service } = await world();
    await teamsRoom(incident.id, service.id);
    await publishSquireUpdate(update(incident.id, 'INVESTIGATION'));
    expect(teams.post).toHaveBeenCalledTimes(1);
    const card = teams.post.mock.calls[0][0].card as { body: Array<{ id?: string }> };
    expect(card.body[0].id).toBe('squire_identity');
    expect(JSON.stringify(card)).toContain(`[deploy](${BASE}/changes/c1)`);

    await publishSquireUpdate(update(incident.id, 'INVESTIGATION', 'Narrowed to the database.'));
    expect(teams.update).toHaveBeenCalledTimes(1);
    expect(teams.update.mock.calls[0][0]).toMatchObject({
      conversationId: `${TEAMS_CHANNEL};messageid=act-1`,
      messageId: 'act-1',
    });

    await publishSquireUpdate(update(incident.id, 'VERIFICATION', 'Error rate back to baseline.'));
    expect(teams.thread).toHaveBeenCalledTimes(1);
    expect(teams.thread.mock.calls[0][0]).toMatchObject({
      conversationId: `${TEAMS_CHANNEL};messageid=act-1`,
      replyToId: 'act-1',
    });
    // Slack got its own copies.
    expect(calls('chat.postMessage')).toHaveLength(2);
    expect(await db.squireChannelMessage.count({ where: { provider: 'TEAMS' } })).toBe(2);
  });
});

describe('investigate', () => {
  it('runs for a linked responder on the channel’s incident, with progress edits', async () => {
    await world();
    await mention('U_OWNER', '<@U0BOT> investigate the database');
    const placeholder = calls('chat.postMessage')[0].body;
    expect(placeholder.thread_ts).toBe('1700000000.000100');
    expect(JSON.stringify(placeholder)).toContain('is looking into it');
    const answer = finalAnswer();
    expect(JSON.stringify(answer)).not.toContain(SQUIRE_CHAT_NO_INCIDENT_ACCESS);
    expect(JSON.stringify(answer)).not.toContain(SQUIRE_CHAT_NOT_LINKED);
  });

  it('answers "@Squire investigate" typed as plain text, by the configured name too', async () => {
    await world({ squireName: 'Sage' });
    expect(await mention('U_OWNER', '@Squire investigate', 'message')).not.toBeNull();
    expect(await mention('U_OWNER', '@sage, investigate', 'message')).not.toBeNull();
    expect(await db.chatOpsIntent.count()).toBe(2);
    // Ordinary channel messages are not Squire's business.
    expect(await mention('U_OWNER', 'we should investigate', 'message')).toBeNull();
    expect(await mention('U_OWNER', '@squirely hi', 'message')).toBeNull();
  });

  it('refuses an unlinked Slack account privately, with nothing in the thread', async () => {
    await world();
    await mention('U_NOBODY', '<@U0BOT> investigate');
    expect(slackCalls.map(call => call.method)).toEqual(['chat.postEphemeral']);
    expect(calls('chat.postEphemeral')[0].body).toMatchObject({
      channel: CHANNEL,
      user: 'U_NOBODY',
    });
    expect(JSON.stringify(calls('chat.postEphemeral')[0].body)).toContain(SQUIRE_CHAT_NOT_LINKED);
  });

  it('refuses a linked person who cannot read the incident', async () => {
    await world();
    await mention('U_OUT', '<@U0BOT> investigate');
    expect(JSON.stringify(finalAnswer())).toContain(SQUIRE_CHAT_NO_INCIDENT_ACCESS);
  });

  it('routes /incident investigate and refuses it without incident access', async () => {
    await world();
    const slash = (user: string) =>
      handleSlashCommand({
        command: '/incident',
        text: 'investigate checkout latency',
        channel_id: CHANNEL,
        channel_name: 'inc-checkout',
        user_id: user,
        user_name: user,
        team_id: WORKSPACE,
        response_url: 'https://hooks.slack.com/commands/T/1/2',
      }) as Promise<{ response_type: string; text?: string; blocks?: unknown }>;
    const denied = await slash('U_OUT');
    expect(denied.response_type).toBe('ephemeral');
    expect(JSON.stringify(denied)).toContain(SQUIRE_CHAT_NO_INCIDENT_ACCESS);
    const allowed = await slash('U_OWNER');
    expect(JSON.stringify(allowed)).not.toContain(SQUIRE_CHAT_NO_INCIDENT_ACCESS);
    expect(JSON.stringify(allowed.blocks)).toContain('squire_identity');
    const unlinked = await slash('U_NOBODY');
    expect(JSON.stringify(unlinked)).toContain('not linked');
  });
});

describe('chat reply delivery', () => {
  const reply = {
    channel: CHANNEL,
    thread_ts: '1700000000.000100',
    text: 'Answer',
    blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'Answer' } }],
    __serviceId: null,
    __teamId: WORKSPACE,
    __placeholderTs: '1700000000.000050',
  };

  it('replaces the progress message, and posts anew only when that message is gone', async () => {
    await world();
    slackOverrides.set('chat.update', { ok: false, error: 'internal_error' });
    await expect(deliverSlackSquireReply(reply)).rejects.toThrow(/internal_error/);
    expect(calls('chat.postMessage')).toHaveLength(0);
    slackOverrides.set('chat.update', { ok: false, error: 'message_not_found' });
    await deliverSlackSquireReply(reply);
    expect(calls('chat.postMessage')).toHaveLength(1);
    expect(calls('chat.postMessage')[0].body).toMatchObject({ thread_ts: reply.thread_ts });
  });

  it('resends as text alone when Slack refuses the blocks', async () => {
    await world();
    slackOverrides.set('chat.postMessage', { ok: false, error: 'invalid_blocks' });
    await deliverSlackSquireReply({ ...reply, __placeholderTs: undefined });
    const [refused, resent] = calls('chat.postMessage');
    expect(refused.body.blocks).toBeDefined();
    expect(resent.body.blocks).toBeUndefined();
    expect(resent.body.text).toContain('Answer');
  });

  it('reuses the progress message of an earlier attempt instead of posting another', async () => {
    await world();
    await enqueueSlackSquireMention({
      team_id: WORKSPACE,
      event_id: 'EvRetry',
      event: {
        type: 'app_mention',
        user: 'U_OWNER',
        text: '<@U0BOT> help',
        channel: CHANNEL,
        ts: '1700000000.000100',
      },
    });
    const intent = await db.chatOpsIntent.findFirstOrThrow();
    // The first attempt posted its progress message and then failed.
    await db.chatOpsIntent.update({
      where: { id: intent.id },
      data: { status: 'FAILED', responsePayload: { squirePlaceholder: '1700000000.000077' } },
    });
    await processChatOpsIntent(intent.id);
    expect(calls('chat.postMessage')).toHaveLength(0);
    expect(calls('chat.update').at(-1)?.body.ts).toBe('1700000000.000077');
  });

  it('Teams: posts anew only when the progress reply is gone, otherwise retries', async () => {
    await world();
    const payload = {
      __kind: 'SQUIRE_MENTION' as const,
      tenantId: TENANT,
      serviceUrl: 'https://smba.trafficmanager.net/emea',
      conversationId: `${TEAMS_CHANNEL};messageid=1`,
      activityId: '1',
      channelIds: [TEAMS_CHANNEL],
      fromId: '29:owner',
      aadObjectId: null,
      fromName: null,
      text: 'hi',
    };
    const card = { type: 'AdaptiveCard' };
    teams.update.mockResolvedValueOnce({ success: false, error: 'boom', errorCode: 'http_500' });
    await expect(deliverTeamsSquireReply(payload, { card, placeholderId: 'p1' })).rejects.toThrow();
    expect(teams.reply).not.toHaveBeenCalled();
    teams.update.mockResolvedValueOnce({
      success: false,
      error: 'gone',
      errorCode: 'MESSAGE_NOT_FOUND',
    });
    await deliverTeamsSquireReply(payload, { card, placeholderId: 'p1' });
    expect(teams.reply).toHaveBeenCalledTimes(1);
  });
});

describe('publishSquireUpdate robustness', () => {
  it('backs off the whole installation after its token was revoked', async () => {
    const { incident } = await world();
    slackOverrides.set('chat.postMessage', { ok: false, error: 'token_revoked' });
    await publishSquireUpdate(update(incident.id, 'SUMMARY'));
    await publishSquireUpdate(update(incident.id, 'INVESTIGATION'));
    await publishSquireUpdate(update(incident.id, 'SUMMARY'));
    expect(calls('chat.postMessage')).toHaveLength(1);
    expect(await db.squireChannelMessage.count()).toBe(0);
  });

  it('records a sent message even when the first row write fails, so it is never re-posted', async () => {
    const { incident } = await world();
    const spy = vi
      .spyOn(prisma.squireChannelMessage, 'update')
      .mockRejectedValueOnce(new Error('connection reset'));
    try {
      await publishSquireUpdate(update(incident.id, 'SUMMARY'));
      // The failed write was retried, not given up on.
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
    }
    const row = await db.squireChannelMessage.findFirstOrThrow();
    expect(row.messageId).not.toBe('');
    await publishSquireUpdate(update(incident.id, 'SUMMARY'));
    expect(calls('chat.postMessage')).toHaveLength(1);
  });

  it('posts both of two different digests published at once', async () => {
    const { incident } = await world();
    await publishSquireUpdate(update(incident.id, 'INVESTIGATION'));
    await Promise.all([
      publishSquireUpdate(update(incident.id, 'DIGEST', 'First change')),
      publishSquireUpdate(update(incident.id, 'DIGEST', 'Second change')),
    ]);
    const replies = calls('chat.postMessage').filter(call => call.body.thread_ts);
    expect(replies).toHaveLength(2);
  });

  it('resends an update as text alone when Slack refuses its blocks', async () => {
    const { incident } = await world();
    slackOverrides.set('chat.postMessage', { ok: false, error: 'invalid_blocks' });
    await publishSquireUpdate(update(incident.id, 'SUMMARY'));
    const [, resent] = calls('chat.postMessage');
    expect(resent.body.blocks).toEqual([]);
    expect(String(resent.body.text)).toContain('Errors began');
    expect(await db.squireChannelMessage.count()).toBe(1);
  });

  it('retries a failed update from a background job until it is delivered', async () => {
    const { incident } = await world();
    slackOverrides.set('chat.postMessage', { ok: false, error: 'internal_error' });
    await publishSquireUpdate(update(incident.id, 'SUMMARY'));
    slackOverrides.set('chat.postMessage', { ok: false, error: 'internal_error' });
    await publishSquireUpdate(update(incident.id, 'SUMMARY', 'Newer text'));
    // One stored retry per update, carrying the newest content, bounded in attempts.
    const job = await db.backgroundJob.findFirstOrThrow({ where: { type: 'SCHEDULED_TASK' } });
    expect(await db.backgroundJob.count()).toBe(1);
    expect(job.maxAttempts).toBe(SQUIRE_CHANNEL_RETRY_ATTEMPTS);
    expect(job.scheduledAt.getTime()).toBeGreaterThan(Date.now());
    expect(job.payload).toMatchObject({ task: 'SQUIRE_CHANNEL_RETRY', markdown: 'Newer text' });

    slackOverrides.set('chat.postMessage', { ok: false, error: 'internal_error' });
    await expect(processSquireChannelRetry(job.payload)).rejects.toThrow(/not delivered/);
    await processSquireChannelRetry(job.payload);
    expect(blockTexts(calls('chat.postMessage').at(-1)!.body)).toContain('Newer text');
    expect(await db.squireChannelMessage.count()).toBe(1);
  });

  it('gives up after the bounded attempts and records the failure on the job', async () => {
    const { incident } = await world();
    slackOverrides.set('chat.postMessage', { ok: false, error: 'internal_error' });
    await publishSquireUpdate(update(incident.id, 'SUMMARY'));
    const job = await db.backgroundJob.findFirstOrThrow();
    await db.backgroundJob.update({
      where: { id: job.id },
      data: { attempts: SQUIRE_CHANNEL_RETRY_ATTEMPTS },
    });
    await markJobFailed(job.id, 'Squire channel update not delivered (failed)');
    expect(await db.backgroundJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
      status: 'FAILED',
      error: 'Squire channel update not delivered (failed)',
    });
  });

  it('flags the war room for an administrator when the Slack app lacks a scope, without retrying', async () => {
    const { incident } = await world();
    slackOverrides.set('chat.postMessage', {
      ok: false,
      error: 'missing_scope',
      needed: 'chat:write',
    });
    await publishSquireUpdate(update(incident.id, 'SUMMARY'));
    const room = await db.incidentWarRoom.findFirstOrThrow({ where: { incidentId: incident.id } });
    expect(room).toMatchObject({
      health: 'PERMISSION_ERROR',
      lastErrorCode: 'SQUIRE_MISSING_SCOPE',
    });
    expect(room.lastError).toContain('missing the chat:write scope');
    expect(await db.backgroundJob.count()).toBe(0);
    expect(
      await db.squireChannelBackoff.count({ where: { key: `SLACK:installation:${WORKSPACE}` } })
    ).toBe(1);
  });

  it('says the app must be invited when it is not in the channel', async () => {
    const { incident } = await world();
    slackOverrides.set('chat.postMessage', { ok: false, error: 'not_in_channel' });
    await publishSquireUpdate(update(incident.id, 'SUMMARY'));
    const room = await db.incidentWarRoom.findFirstOrThrow({ where: { incidentId: incident.id } });
    expect(room.health).toBe('PERMISSION_ERROR');
    expect(room.lastError).toContain('Invite it to the channel');
    expect(await db.backgroundJob.count()).toBe(0);
  });
});
