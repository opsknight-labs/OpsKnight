import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  warRoom: vi.fn(),
  incident: vi.fn(),
  enabled: vi.fn(),
  rate: vi.fn(),
  integration: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    incidentWarRoom: { findFirst: h.warRoom },
    incident: { findFirst: h.incident },
    slackIntegration: { findFirst: h.integration },
  },
}));
vi.mock('@/lib/chatops/squire/handler', () => ({
  isSquireChatOpsEnabled: h.enabled,
  chatBaseUrl: () => 'https://ops.example.com',
}));
vi.mock('@/lib/chatops/squire/publish', () => ({ SLACK_GONE: new Set() }));
vi.mock('@/lib/chatops/squire/identity', () => ({
  loadSquireIdentity: vi.fn().mockResolvedValue({ name: 'Squire' }),
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: h.rate }));
vi.mock('@/lib/slack', () => ({ getSlackBotToken: vi.fn().mockResolvedValue('xoxb-env') }));
vi.mock('@/lib/chatops/intents', () => ({ enqueueChatOpsIntent: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { absolutizeAppPaths, markdownToSlack, markdownToTeams } from '@/lib/chatops/squire/render';
import { findSlackIncidentForChannel } from '@/lib/chatops/squire/slack';
import {
  enqueueSlackSquireMention,
  SQUIRE_CHAT_OFF_NOTICE,
} from '@/lib/chatops/squire/slack-events';
import { enqueueChatOpsIntent } from '@/lib/chatops/intents';
import { logger } from '@/lib/logger';

const BASE = 'https://ops.example.com';

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('Squire links in chat are absolute', () => {
  it('turns bare in-app paths into absolute links', () => {
    expect(absolutizeAppPaths('See /incidents/abc123. Then /services/s1, ok', BASE)).toBe(
      `See <${BASE}/incidents/abc123>. Then <${BASE}/services/s1>, ok`
    );
    expect(markdownToSlack('• Related: DB\n  /incidents/x1', BASE)).toContain(
      `<${BASE}/incidents/x1>`
    );
    expect(markdownToTeams('Open /services/s1 now', BASE)).toBe(`Open ${BASE}/services/s1 now`);
  });

  it('leaves slash commands and words alone, and never rewrites inside a link', () => {
    expect(absolutizeAppPaths('Run /incident ack and/or wait', BASE)).toBe(
      'Run /incident ack and/or wait'
    );
    expect(markdownToSlack('[Open](/incidents/a)', BASE)).toBe(`<${BASE}/incidents/a|Open>`);
    expect(markdownToTeams('[Open](/incidents/a)', BASE)).toBe(`[Open](${BASE}/incidents/a)`);
  });
});

describe('Squire in an incident channel is scoped to that incident', () => {
  it('resolves the channel through its war room first', async () => {
    h.warRoom.mockResolvedValue({
      incident: { id: 'inc-wr', serviceId: 's', title: 't', visibility: 'PUBLIC' },
    });
    await expect(findSlackIncidentForChannel('T1', 'C1')).resolves.toMatchObject({ id: 'inc-wr' });
    expect(h.warRoom.mock.calls[0][0]).toMatchObject({
      where: { provider: 'SLACK', providerTenantId: 'T1', providerChannelId: 'C1' },
    });
    expect(h.incident).not.toHaveBeenCalled();
  });

  it('falls back to the legacy incident channel link', async () => {
    h.warRoom.mockResolvedValue(null);
    h.incident.mockResolvedValue({ id: 'inc-legacy' });
    await expect(findSlackIncidentForChannel('T1', 'C1')).resolves.toMatchObject({
      id: 'inc-legacy',
    });
  });
});

describe('Squire turned off for chat', () => {
  it('replies privately once and logs at info instead of dropping the mention', async () => {
    h.enabled.mockResolvedValue(false);
    h.rate.mockResolvedValue({ allowed: true });
    h.integration.mockResolvedValue(null);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);
    const queued = await enqueueSlackSquireMention({
      team_id: 'T1',
      event_id: 'Ev1',
      event: { type: 'app_mention', user: 'U1', text: '<@UBOT> hi', channel: 'C1', ts: '1.1' },
    });
    expect(queued).toBe(false);
    expect(enqueueChatOpsIntent).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://slack.com/api/chat.postEphemeral',
      expect.objectContaining({ body: expect.stringContaining('Squire is turned off for chat') })
    );
    expect(SQUIRE_CHAT_OFF_NOTICE).toContain('Settings → Intelligence → AI');
  });
});

describe('Squire in a direct message', () => {
  const dm = (extra: Record<string, unknown> = {}) => ({
    team_id: 'T1',
    event_id: 'Ev2',
    event: {
      type: 'message',
      channel_type: 'im',
      user: 'U1',
      text: 'whats up, who is on call?',
      channel: 'D1',
      ts: '1.1',
      ...extra,
    },
  });

  it('answers a plain direct message without an @ or an incident', async () => {
    h.enabled.mockResolvedValue(true);
    expect(await enqueueSlackSquireMention(dm())).toBe(true);
    expect(enqueueChatOpsIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'D1',
        payload: expect.objectContaining({ text: 'whats up, who is on call?' }),
      })
    );
  });

  it('ignores edits, bot posts and empty messages', async () => {
    h.enabled.mockResolvedValue(true);
    expect(await enqueueSlackSquireMention(dm({ subtype: 'message_changed' }))).toBe(false);
    expect(await enqueueSlackSquireMention(dm({ bot_id: 'B1' }))).toBe(false);
    expect(await enqueueSlackSquireMention(dm({ text: '  ' }))).toBe(false);
    expect(enqueueChatOpsIntent).not.toHaveBeenCalled();
  });
});
