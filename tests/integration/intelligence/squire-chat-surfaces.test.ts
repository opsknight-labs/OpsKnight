import { beforeEach, describe, expect, it, vi } from 'vitest';

// No browser session exists for chat clicks; any accidental session use fails loudly.
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => null) }));
vi.mock('@/lib/auth', () => ({ getAuthOptions: vi.fn(async () => ({})) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/slack', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/slack')>()),
  getSlackBotToken: vi.fn(async () => 'xoxb-test'),
}));
// Slack users.info: the verified email of each Slack account.
const slackEmails = vi.hoisted(() => new Map<string, string>());
vi.mock('@/lib/retry', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/retry')>()),
  retryFetch: vi.fn(async (url: string) => {
    const user = new URL(url).searchParams.get('user') ?? '';
    const email = slackEmails.get(user);
    return {
      json: async () =>
        email ? { ok: true, user: { profile: { email } } } : { ok: false, error: 'user_not_found' },
    };
  }),
}));

import { resolveUserActor } from '@/lib/authorization-actors';
import { processChatOpsIntent } from '@/lib/chatops/intents';
import { handleSlashCommand } from '@/lib/chatops/slash-commands';
import {
  answerChatQuestion,
  SQUIRE_CHAT_DISABLED,
  SQUIRE_CHAT_NOT_LINKED,
  SQUIRE_CHAT_NOT_OWNER,
  SQUIRE_CHAT_QUESTIONS_PER_MINUTE,
  SQUIRE_CHAT_RATE_LIMITED,
} from '@/lib/chatops/squire/handler';
import { handleSlackSquireButton } from '@/lib/chatops/squire/slack';
import { enqueueSlackSquireMention } from '@/lib/chatops/squire/slack-events';
import {
  answerTeamsSquireMention,
  handleTeamsSquireConfirm,
  mentionsBot,
  type TeamsSquireMentionPayload,
} from '@/lib/chatops/squire/teams';
import {
  parseSquireButtonValue,
  SQUIRE_SLACK_CONFIRM_ACTION,
  SQUIRE_SLACK_DISMISS_ACTION,
  SQUIRE_TEAMS_CONFIRM_VERB,
} from '@/lib/chatops/squire/render';
import { askSquireForMcp } from '@/lib/mcp/core/ask-squire';
import { ASK_SQUIRE_SCOPES } from '@/lib/mcp/core/ask-squire-contract';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { createOpsKnightMcpServer } from '@/lib/mcp/protocol/server';
import { CostBudget } from '@/lib/mcp/core/budget';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { resolvePageContext } from '@/lib/intelligence/squire/deterministic';
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
const posted: Array<{ url: string; body: Record<string, unknown> }> = [];

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
  slackEmails.clear();
  posted.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      posted.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
      return new Response(JSON.stringify({ ok: true, id: 'reply-1' }), { status: 200 });
    })
  );
});

async function world(options: { chatOps?: boolean; mcp?: boolean } = {}) {
  await db.aiSettings.create({
    data: {
      id: 'default',
      enabled: false,
      squireEnabled: true,
      squireChatOpsEnabled: options.chatOps ?? true,
      squireMcpEnabled: options.mcp ?? false,
    },
  });
  const team = await createTestTeam('Checkout');
  const outsiderTeam = await createTestTeam('Elsewhere');
  const owner = await createTestUser({
    role: 'RESPONDER',
    name: 'Olive Owner',
    email: 'olive@example.com',
  });
  const teammate = await createTestUser({
    role: 'RESPONDER',
    name: 'Tom Mate',
    email: 'tom@example.com',
  });
  const outsider = await createTestUser({
    role: 'USER',
    name: 'Otto Out',
    email: 'otto@example.com',
  });
  for (const user of [owner, teammate])
    await db.teamMember.create({ data: { userId: user.id, teamId: team.id, role: 'MEMBER' } });
  await db.teamMember.create({
    data: { userId: outsider.id, teamId: outsiderTeam.id, role: 'MEMBER' },
  });
  const service = await createTestService('Checkout API', team.id, { name: 'Checkout API' });
  const incident = await createTestIncident('Checkout errors', service.id, {
    assigneeId: owner.id,
  });
  await db.incident.update({
    where: { id: incident.id },
    data: { slackChannelId: CHANNEL, slackWorkspaceId: WORKSPACE },
  });
  slackEmails.set('U_OWNER', 'olive@example.com');
  slackEmails.set('U_MATE', 'tom@example.com');
  slackEmails.set('U_OUT', 'otto@example.com');
  return { team, owner, teammate, outsider, service, incident };
}

const mention = (user: string, text: string, eventId = `Ev${Math.random()}`) => ({
  team_id: WORKSPACE,
  event_id: eventId,
  event: { type: 'app_mention', user, text, channel: CHANNEL, ts: '1700000000.000100' },
});

/** Queue a mention as the events route does, run the worker, and return the posted reply. */
async function mentionAndReply(user: string, text: string) {
  expect(await enqueueSlackSquireMention(mention(user, text))).toBe(true);
  const intent = await db.chatOpsIntent.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
  await processChatOpsIntent(intent.id);
  const reply = posted.filter(call => call.url.includes('chat.postMessage')).at(-1);
  expect(reply).toBeDefined();
  return { reply: reply!.body, intent };
}

function confirmValue(blocks: unknown): string | undefined {
  const actions = (
    blocks as Array<{ type: string; elements?: Array<{ action_id: string; value?: string }> }>
  )
    .filter(block => block.type === 'actions')
    .flatMap(block => block.elements ?? []);
  return actions.find(element => element.action_id === SQUIRE_SLACK_CONFIRM_ACTION)?.value;
}

const click = (user: string, actionId: string, value: string) =>
  handleSlackSquireButton({
    actions: [{ action_id: actionId, value }],
    user: { id: user },
    team: { id: WORKSPACE },
    channel: { id: CHANNEL },
    container: { channel_id: CHANNEL, thread_ts: '1700000000.000100' },
  });

describe('Squire in Slack: @mention', () => {
  it('answers a linked person in the thread, with the incident as context and proposals as buttons', async () => {
    const w = await world();
    const { reply } = await mentionAndReply('U_OWNER', '<@U0BOT> acknowledge this');
    expect(reply).toMatchObject({ channel: CHANNEL, thread_ts: '1700000000.000100' });
    const value = confirmValue(reply.blocks);
    expect(parseSquireButtonValue(value)?.owner).toBe(w.owner.id);
    // Nothing ran: a proposal is only a card.
    expect((await db.incident.findUniqueOrThrow({ where: { id: w.incident.id } })).status).toBe(
      'OPEN'
    );
    // The stored response is sealed, not plain text.
    const stored = await db.chatOpsIntent.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
    expect(JSON.stringify(stored.responsePayload)).not.toContain('acknowledge');
    expect(stored.status).toBe('COMPLETED');
  });

  it('refuses to answer for a Slack account that is not linked to an active user', async () => {
    await world();
    const { reply } = await mentionAndReply('U_STRANGER', '<@U0BOT> what is going on?');
    expect(JSON.stringify(reply.blocks)).toContain(SQUIRE_CHAT_NOT_LINKED.slice(0, 40));
  });

  it('answers with the asker’s own permissions: an outsider gets no proposal for the incident', async () => {
    await world();
    const { reply } = await mentionAndReply('U_OUT', '<@U0BOT> acknowledge this');
    expect(confirmValue(reply.blocks)).toBeUndefined();
  });

  it('queues nothing while Squire for chat is off (the default)', async () => {
    await world({ chatOps: false });
    expect(await enqueueSlackSquireMention(mention('U_OWNER', '<@U0BOT> hi'))).toBe(false);
    expect(await db.chatOpsIntent.count()).toBe(0);
  });

  it('ignores bot messages and de-duplicates a redelivered event', async () => {
    await world();
    expect(
      await enqueueSlackSquireMention({
        ...mention('U_OWNER', 'hi', 'EvBot'),
        event: { ...mention('U_OWNER', 'hi').event, bot_id: 'B1' },
      })
    ).toBe(false);
    await enqueueSlackSquireMention(mention('U_OWNER', '<@U0BOT> hi', 'EvSame'));
    await enqueueSlackSquireMention(mention('U_OWNER', '<@U0BOT> hi', 'EvSame'));
    expect(await db.chatOpsIntent.count()).toBe(1);
  });
});

describe('Squire in Slack: confirm buttons', () => {
  it('lets only the owner confirm, and reports success only with the executor receipt', async () => {
    const w = await world();
    const { reply } = await mentionAndReply('U_OWNER', '<@U0BOT> acknowledge this');
    const value = confirmValue(reply.blocks)!;

    const stranger = await click('U_MATE', SQUIRE_SLACK_CONFIRM_ACTION, value);
    expect(stranger).toMatchObject({ response_type: 'ephemeral' });
    expect(String(stranger.text)).toContain(SQUIRE_CHAT_NOT_OWNER.slice(0, 30));
    expect(await db.squireActionReceipt.count()).toBe(0);
    expect((await db.incident.findUniqueOrThrow({ where: { id: w.incident.id } })).status).toBe(
      'OPEN'
    );

    const dismissedByStranger = await click('U_MATE', SQUIRE_SLACK_DISMISS_ACTION, value);
    expect(String(dismissedByStranger.text)).toContain(SQUIRE_CHAT_NOT_OWNER.slice(0, 30));

    const confirmed = await click('U_OWNER', SQUIRE_SLACK_CONFIRM_ACTION, value);
    expect(confirmed).toMatchObject({
      response_type: 'in_channel',
      thread_ts: '1700000000.000100',
    });
    expect(String(confirmed.text)).toContain('Incident acknowledged.');
    const incident = await db.incident.findUniqueOrThrow({ where: { id: w.incident.id } });
    expect(incident.status).toBe('ACKNOWLEDGED');
    const receipt = await db.squireActionReceipt.findFirstOrThrow();
    expect(receipt).toMatchObject({ userId: w.owner.id, status: 'SUCCEEDED' });
    const audit = await db.auditLog.findFirst({
      where: { action: 'intelligence.squire.action', entityId: w.incident.id },
    });
    expect(audit?.details).toMatchObject({
      source: 'INTEGRATION',
      metadata: { outcome: 'SUCCEEDED', channel: 'SLACK' },
    });

    // A second click replays the stored receipt; the incident is not changed twice.
    const again = await click('U_OWNER', SQUIRE_SLACK_CONFIRM_ACTION, value);
    expect(String(again.text)).toContain('Incident acknowledged.');
    expect(await db.squireActionReceipt.count()).toBe(1);
  });

  it('refuses a forged owner: the sealed token still names the person it was made for', async () => {
    const w = await world();
    const { reply } = await mentionAndReply('U_OWNER', '<@U0BOT> acknowledge this');
    const { token } = parseSquireButtonValue(confirmValue(reply.blocks))!;
    const forged = JSON.stringify({ v: 1, t: token, o: w.teammate.id });
    const result = await click('U_MATE', SQUIRE_SLACK_CONFIRM_ACTION, forged);
    expect(result).toMatchObject({ response_type: 'ephemeral' });
    expect(String(result.text)).toContain('expired');
    expect((await db.incident.findUniqueOrThrow({ where: { id: w.incident.id } })).status).toBe(
      'OPEN'
    );
  });

  it('re-checks permissions at confirm time: a person who lost access cannot confirm', async () => {
    const w = await world();
    const { reply } = await mentionAndReply('U_OWNER', '<@U0BOT> acknowledge this');
    const value = confirmValue(reply.blocks)!;
    // Demoted to a team-scoped role and removed from the team after the suggestion was made.
    await db.user.update({ where: { id: w.owner.id }, data: { role: 'USER' } });
    await db.teamMember.deleteMany({ where: { userId: w.owner.id } });
    await db.incident.update({ where: { id: w.incident.id }, data: { assigneeId: null } });
    const result = await click('U_OWNER', SQUIRE_SLACK_CONFIRM_ACTION, value);
    expect(result).toMatchObject({ response_type: 'ephemeral' });
    expect((await db.incident.findUniqueOrThrow({ where: { id: w.incident.id } })).status).toBe(
      'OPEN'
    );
  });

  it('refuses when Squire for chat was turned off after the answer', async () => {
    const w = await world();
    const { reply } = await mentionAndReply('U_OWNER', '<@U0BOT> acknowledge this');
    await db.aiSettings.update({ where: { id: 'default' }, data: { squireChatOpsEnabled: false } });
    const result = await click('U_OWNER', SQUIRE_SLACK_CONFIRM_ACTION, confirmValue(reply.blocks)!);
    expect(String(result.text)).toContain(SQUIRE_CHAT_DISABLED.slice(0, 30));
    expect((await db.incident.findUniqueOrThrow({ where: { id: w.incident.id } })).status).toBe(
      'OPEN'
    );
  });
});

describe('Squire in Slack: /incident ask and limits', () => {
  it('answers /incident ask privately in the war room', async () => {
    await world();
    const response = (await handleSlashCommand({
      command: '/incident',
      text: 'ask acknowledge this',
      channel_id: CHANNEL,
      channel_name: 'inc-checkout',
      user_id: 'U_OWNER',
      user_name: 'olive',
      team_id: WORKSPACE,
      response_url: 'https://hooks.slack.com/commands/T/1/2',
    })) as { response_type: string; blocks?: unknown };
    expect(response.response_type).toBe('ephemeral');
    expect(confirmValue(response.blocks)).toBeDefined();
  });

  it('rate-limits questions per person', async () => {
    const w = await world();
    for (let i = 0; i < SQUIRE_CHAT_QUESTIONS_PER_MINUTE; i += 1) {
      const answer = await answerChatQuestion({
        provider: 'SLACK',
        userId: w.owner.id,
        question: 'help',
        incidentId: w.incident.id,
      });
      expect(answer.error).toBeUndefined();
    }
    const limited = await answerChatQuestion({
      provider: 'MICROSOFT_TEAMS',
      userId: w.owner.id,
      question: 'help',
      incidentId: w.incident.id,
    });
    expect(limited.error).toBe(SQUIRE_CHAT_RATE_LIMITED);
    // Another person is unaffected.
    const other = await answerChatQuestion({
      provider: 'SLACK',
      userId: w.teammate.id,
      question: 'help',
      incidentId: w.incident.id,
    });
    expect(other.error).toBeUndefined();
  });
});

describe('Squire in Microsoft Teams', () => {
  const TENANT = 'tenant-1';
  async function teamsWorld() {
    const w = await world();
    await db.incidentWarRoom.create({
      data: {
        incidentId: w.incident.id,
        provider: 'MICROSOFT_TEAMS',
        state: 'READY',
        providerTenantId: TENANT,
        providerChannelId: '19:room@thread.tacv2',
      },
    });
    for (const [providerUserId, userId] of [
      ['29:owner', w.owner.id],
      ['29:mate', w.teammate.id],
    ] as const)
      await db.chatIdentityLink.create({
        data: {
          provider: 'MICROSOFT_TEAMS',
          providerTenantId: TENANT,
          providerUserId,
          userId,
          verificationMethod: 'OIDC',
        },
      });
    return w;
  }
  const payload = (fromId: string, text: string): TeamsSquireMentionPayload => ({
    __kind: 'SQUIRE_MENTION',
    tenantId: TENANT,
    serviceUrl: 'https://smba.trafficmanager.net/emea',
    conversationId: '19:room@thread.tacv2;messageid=1',
    activityId: 'act-1',
    channelIds: ['19:room@thread.tacv2'],
    fromId,
    aadObjectId: null,
    fromName: null,
    text,
  });

  it('answers only an explicit @mention of the bot', () => {
    const base = { recipient: { id: '28:bot' } };
    expect(
      mentionsBot({ ...base, entities: [{ type: 'mention', mentioned: { id: '28:bot' } }] })
    ).toBe(true);
    expect(
      mentionsBot({ ...base, entities: [{ type: 'mention', mentioned: { id: '29:someone' } }] })
    ).toBe(false);
    expect(mentionsBot({ ...base })).toBe(false);
  });

  it('answers a linked person in a war room and confirms only for the owner', async () => {
    const w = await teamsWorld();
    const { card } = await answerTeamsSquireMention(
      payload('29:owner', '<at>Squire</at> acknowledge this')
    );
    const execute = (card as { actions?: Array<{ verb?: string; data?: unknown }> }).actions?.find(
      action => action.verb === SQUIRE_TEAMS_CONFIRM_VERB
    );
    expect(execute).toBeDefined();
    const invoke = (fromId: string) =>
      handleTeamsSquireConfirm({
        verifiedTenantId: TENANT,
        activity: {
          from: { id: fromId },
          value: {
            action: {
              type: 'Action.Execute',
              verb: SQUIRE_TEAMS_CONFIRM_VERB,
              data: execute!.data,
            },
          },
        },
      });
    expect(await invoke('29:mate')).toMatchObject({ statusCode: 403 });
    expect(await invoke('29:nobody')).toMatchObject({ statusCode: 409 });
    expect((await db.incident.findUniqueOrThrow({ where: { id: w.incident.id } })).status).toBe(
      'OPEN'
    );
    const ok = await invoke('29:owner');
    expect(ok).toMatchObject({ statusCode: 200 });
    expect(String(ok.value)).toContain('Incident acknowledged.');
    expect((await db.incident.findUniqueOrThrow({ where: { id: w.incident.id } })).status).toBe(
      'ACKNOWLEDGED'
    );
  });

  it('does not answer outside an incident war room', async () => {
    await teamsWorld();
    const { card } = await answerTeamsSquireMention({
      ...payload('29:owner', 'hi'),
      channelIds: ['19:general@thread.tacv2'],
    });
    expect(JSON.stringify(card)).toContain('I answer in OpsKnight incident war rooms');
  });
});

describe('ask_squire over MCP', () => {
  const mcpActor = async (userId: string, scopes: readonly string[] = ASK_SQUIRE_SCOPES) => ({
    ...(await resolveUserActor(userId))!,
    apiKey: { id: 'grant', scopes },
  });

  it('answers read-only and returns proposals as descriptions without their token', async () => {
    const w = await world({ mcp: true });
    const result = await askSquireForMcp(await mcpActor(w.owner.id), {
      question: 'acknowledge this',
      incidentId: w.incident.id,
    });
    expect(result.suggestedActions).toHaveLength(1);
    expect(result.suggestedActions[0]).toMatchObject({
      incidentId: w.incident.id,
      executed: false,
    });
    expect(JSON.stringify(result)).not.toMatch(/"token"/);
    expect(await db.squireActionReceipt.count()).toBe(0);
    expect((await db.incident.findUniqueOrThrow({ where: { id: w.incident.id } })).status).toBe(
      'OPEN'
    );
  });

  it('is refused while off, and for a connection without every scope', async () => {
    const w = await world({ mcp: false });
    await expect(
      askSquireForMcp(await mcpActor(w.owner.id), { question: 'help' })
    ).rejects.toMatchObject({ code: 'MCP_CAPABILITY_DISABLED' });
    await db.aiSettings.update({ where: { id: 'default' }, data: { squireMcpEnabled: true } });
    await expect(
      askSquireForMcp(await mcpActor(w.owner.id, ['incidents:read']), { question: 'help' })
    ).rejects.toMatchObject({ code: 'MCP_OPERATION_FORBIDDEN' });
  });
});

describe('ask_squire over the MCP protocol', () => {
  async function callTool(actor: AuthorizationActor, args: Record<string, unknown>) {
    const handler = createMcpHandler(
      () =>
        createOpsKnightMcpServer(
          {
            grantId: 'grant',
            tokenScopes: [...(actor.apiKey?.scopes ?? [])],
            requestId: 'req-1',
            budget: new CostBudget(),
          },
          actor,
          false,
          false,
          [],
          { squire: true }
        ),
      { legacy: 'reject', responseMode: 'json', maxSubscriptions: 0 }
    );
    try {
      const response = await handler.fetch(
        new Request('http://localhost/mcp', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            'mcp-protocol-version': '2026-07-28',
            'mcp-method': 'tools/call',
            'mcp-name': 'ask_squire',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
              name: 'ask_squire',
              arguments: args,
              _meta: {
                'io.modelcontextprotocol/protocolVersion': '2026-07-28',
                'io.modelcontextprotocol/clientCapabilities': {},
                'io.modelcontextprotocol/clientInfo': { name: 'f5', version: '1' },
              },
            },
          }),
        })
      );
      return (await response.json()) as {
        result: { isError?: boolean; structuredContent: Record<string, unknown> };
      };
    } finally {
      await handler.close();
    }
  }

  it('answers through tools/call and reports a disabled switch as a capability error', async () => {
    const w = await world({ mcp: true });
    const actor = {
      ...(await resolveUserActor(w.owner.id))!,
      apiKey: { id: 'g', scopes: ASK_SQUIRE_SCOPES },
    };
    const ok = await callTool(actor, { question: 'acknowledge this', incidentId: w.incident.id });
    expect(ok.result.isError).toBeFalsy();
    expect(ok.result.structuredContent).toMatchObject({
      mode: 'basic',
      note: expect.stringContaining('Read-only'),
    });
    expect(JSON.stringify(ok.result)).not.toMatch(/"token"/);

    await db.aiSettings.update({ where: { id: 'default' }, data: { squireMcpEnabled: false } });
    const off = await callTool(actor, { question: 'help' });
    expect(off.result.isError).toBe(true);
    expect(off.result.structuredContent).toMatchObject({
      error: { code: 'MCP_CAPABILITY_DISABLED' },
    });
  });
});

describe('page context', () => {
  it('resolves a change page and keeps runbooks team-scoped', async () => {
    const w = await world();
    const change = await db.changeEvent.create({
      data: {
        source: 'deploy',
        kind: 'DEPLOY',
        summary: 'Deploy checkout v42',
        occurredAt: new Date(),
        serviceId: w.service.id,
      } as never,
    });
    const owner = (await resolveUserActor(w.owner.id))!;
    expect(await resolvePageContext(owner, { kind: 'change', id: change.id })).toMatchObject({
      kind: 'change',
      name: 'Deploy checkout v42',
      serviceName: 'Checkout API',
    });
    const outsider = (await resolveUserActor(w.outsider.id))!;
    expect(await resolvePageContext(outsider, { kind: 'change', id: change.id })).toBeNull();
  });
});
