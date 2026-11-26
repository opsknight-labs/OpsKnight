import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  slackDestinations: vi.fn(),
  teamsDestinations: vi.fn(),
  teamsConfig: vi.fn(),
  teamsInstallation: vi.fn(),
  intent: vi.fn(),
  slackExists: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({
  default: {
    slackDestination: { findMany: mocks.slackDestinations },
    microsoftTeamsDestination: { findMany: mocks.teamsDestinations },
    microsoftTeamsConfig: { findFirst: mocks.teamsConfig },
    microsoftTeamsInstallation: { findFirst: mocks.teamsInstallation },
  },
}));
vi.mock('@/lib/notification-control-plane', () => ({
  createCentralNotificationIntent: mocks.intent,
}));
vi.mock('@/lib/slack', () => ({ slackChannelExists: mocks.slackExists }));

import {
  businessServiceChatTargets,
  contactChannelHref,
  enqueueBusinessServiceChat,
  parseChatChannel,
  validateContactChannel,
} from '@/lib/business-services/chat-channels';
import { escapeSlackText, slackTextBody, teamsWebhookBody } from '@/lib/chat-text';

const TEAMS_LINK =
  'https://teams.microsoft.com/l/channel/19%3Aabc123%40thread.tacv2/Checkout?groupId=team-1&tenantId=tenant-1';

describe('parseChatChannel', () => {
  it('reads Slack ids, #names and archive links', () => {
    expect(parseChatChannel('C0123ABCD')).toEqual({ provider: 'SLACK', channel: 'C0123ABCD' });
    expect(parseChatChannel(' #checkout-ops ')).toEqual({
      provider: 'SLACK',
      channel: '#checkout-ops',
    });
    expect(parseChatChannel('https://acme.slack.com/archives/C0123ABCD/p1700000')).toEqual({
      provider: 'SLACK',
      channel: 'C0123ABCD',
    });
  });

  it('reads a Teams channel link', () => {
    expect(parseChatChannel(TEAMS_LINK)).toEqual({
      provider: 'MICROSOFT_TEAMS',
      tenantId: 'tenant-1',
      teamId: 'team-1',
      channel: '19:abc123@thread.tacv2',
    });
  });

  it('keeps free text as free text', () => {
    for (const value of [
      'ops@example.com',
      'Call the payments desk',
      'http://acme.slack.com/archives/C0123ABCD',
      'https://evil.example/archives/C0123ABCD',
      null,
      '',
    ])
      expect(parseChatChannel(value)).toBeNull();
  });

  it('links what can be linked', () => {
    expect(contactChannelHref('C0123ABCD')).toBe(
      'https://slack.com/app_redirect?channel=C0123ABCD'
    );
    expect(contactChannelHref(TEAMS_LINK)).toBe(TEAMS_LINK);
    expect(contactChannelHref('#checkout')).toBeNull();
    expect(contactChannelHref('ops@example.com')).toBeNull();
  });
});

describe('validateContactChannel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects a Slack channel the connected workspace does not have, and passes the unknown', async () => {
    mocks.slackExists.mockResolvedValueOnce(false);
    expect(await validateContactChannel('C0123ABCD')).toMatch(/not found/);
    mocks.slackExists.mockResolvedValueOnce(null);
    expect(await validateContactChannel('C0123ABCD')).toBeNull();
    expect(await validateContactChannel('free text')).toBeNull();
  });

  it('rejects a Teams team without the app only when Teams is configured', async () => {
    mocks.teamsConfig.mockResolvedValueOnce(null);
    expect(await validateContactChannel(TEAMS_LINK)).toBeNull();
    mocks.teamsConfig.mockResolvedValueOnce({ id: 'cfg' });
    mocks.teamsInstallation.mockResolvedValueOnce(null);
    expect(await validateContactChannel(TEAMS_LINK)).toMatch(/not installed/);
  });
});

describe('businessServiceChatTargets', () => {
  beforeEach(() => vi.clearAllMocks());

  it('puts the contact channel first, adds owner-team channels and dedupes', async () => {
    mocks.slackDestinations.mockResolvedValue([
      { channelId: 'C0123ABCD' },
      { channelId: 'C0999ZZZZ' },
    ]);
    mocks.teamsDestinations.mockResolvedValue([
      { tenantId: 'tenant-1', teamId: 'team-1', channelId: '19:abc123@thread.tacv2' },
    ]);
    const targets = await businessServiceChatTargets({
      id: 'bs1',
      contactChannel: 'https://acme.slack.com/archives/C0123ABCD',
      ownerTeamId: 't1',
    });
    expect(targets).toEqual([
      { provider: 'SLACK', channel: 'C0123ABCD' },
      { provider: 'SLACK', channel: 'C0999ZZZZ' },
      {
        provider: 'MICROSOFT_TEAMS',
        tenantId: 'tenant-1',
        teamId: 'team-1',
        channel: '19:abc123@thread.tacv2',
      },
    ]);
    expect(mocks.slackDestinations.mock.calls[0][0].where.service).toEqual({
      teamId: 't1',
      businessServiceMemberships: { some: { businessServiceId: 'bs1' } },
    });
  });

  it('needs no query without an owner team', async () => {
    expect(
      await businessServiceChatTargets({ id: 'bs1', contactChannel: 'prose', ownerTeamId: null })
    ).toEqual([]);
    expect(mocks.slackDestinations).not.toHaveBeenCalled();
  });
});

describe('enqueueBusinessServiceChat', () => {
  beforeEach(() => vi.clearAllMocks());

  it('queues one durable intent per target under the same event key', async () => {
    mocks.intent.mockResolvedValueOnce({ id: 'n1', created: true });
    mocks.intent.mockResolvedValueOnce({ id: 'n2', created: false });
    const queued = await enqueueBusinessServiceChat({
      businessServiceId: 'bs1',
      targets: [
        { provider: 'SLACK', channel: '#checkout' },
        { provider: 'MICROSOFT_TEAMS', tenantId: 'tn', teamId: 'tm', channel: '19:x@thread.tacv2' },
      ],
      title: 'Checkout is now degraded',
      text: 'Its status changed.',
      templateKey: 'business-service-status-chat',
      eventKey: 'bs1:OPERATIONAL:DEGRADED:0',
    });
    expect(queued).toBe(1);
    expect(mocks.intent.mock.calls.map(call => call[0].eventKey)).toEqual([
      'bs1:OPERATIONAL:DEGRADED:0',
      'bs1:OPERATIONAL:DEGRADED:0',
    ]);
    expect(mocks.intent.mock.calls[0][0]).toMatchObject({
      channel: 'SLACK',
      recipientType: 'SLACK_CHANNEL',
      payload: { kind: 'CHAT_TEXT', provider: 'SLACK', channel: '#checkout' },
    });
    expect(mocks.intent.mock.calls[1][0].payload).toMatchObject({
      provider: 'MICROSOFT_TEAMS',
      tenantId: 'tn',
      teamId: 'tm',
    });
  });
});

describe('chat text', () => {
  it('escapes Slack control characters and drops non-http links', () => {
    expect(escapeSlackText('<!channel> & co')).toBe('&lt;!channel&gt; &amp; co');
    const body = slackTextBody('A <b>', 'x', [
      { label: 'Open', url: 'https://ops.example/a' },
      { label: 'Bad', url: 'javascript:alert(1)' },
    ]);
    const mrkdwn = (body.blocks[0] as { text: { text: string } }).text.text;
    expect(mrkdwn).toContain('*A &lt;b&gt;*');
    expect(mrkdwn).toContain('<https://ops.example/a|Open>');
    expect(mrkdwn).not.toContain('javascript');
  });

  it('wraps a Teams webhook message as one adaptive card', () => {
    const body = teamsWebhookBody('Title', 'Text', [
      { label: 'Unsubscribe', url: 'https://x.example/u' },
    ]);
    expect(body.attachments[0].contentType).toBe('application/vnd.microsoft.card.adaptive');
    expect(body.attachments[0].content.actions).toEqual([
      { type: 'Action.OpenUrl', title: 'Unsubscribe', url: 'https://x.example/u' },
    ]);
  });
});
