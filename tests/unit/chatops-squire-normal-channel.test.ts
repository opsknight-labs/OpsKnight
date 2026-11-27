import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  answer: vi.fn(),
  link: vi.fn(),
  api: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({
  default: {
    incidentWarRoom: { findFirst: vi.fn().mockResolvedValue(null) },
    incident: { findFirst: vi.fn().mockResolvedValue(null) },
    slackIntegration: { findFirst: vi.fn().mockResolvedValue(null) },
  },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));
vi.mock('@/lib/slack', () => ({ getSlackBotToken: vi.fn().mockResolvedValue('xoxb-env') }));
vi.mock('@/lib/chatops/slash-commands', () => ({ resolveOpsKnightUser: h.link }));
vi.mock('@/lib/war-room/providers/slack/client', () => ({ slackApiCall: h.api }));
vi.mock('@/lib/chatops/squire/publish', () => ({ SLACK_GONE: new Set() }));
vi.mock('@/lib/chatops/squire/identity', () => ({
  loadSquireIdentity: vi.fn().mockResolvedValue({ name: 'Squire' }),
  slackCanCustomizeSender: vi.fn().mockResolvedValue(false),
  slackSquireSender: vi.fn().mockReturnValue({}),
  slackSquireBlocks: (blocks: unknown[]) => blocks,
}));
vi.mock('@/lib/chatops/squire/handler', () => ({
  answerChatQuestion: h.answer,
  boundChatHistory: vi.fn().mockReturnValue([]),
  chatBaseUrl: () => 'https://ops.example.com',
  confirmChatProposal: vi.fn(),
  progressEditor: () => ({ push: vi.fn(), settle: vi.fn() }),
  recalledPlaceholder: vi.fn().mockResolvedValue(undefined),
  rememberPlaceholder: vi.fn(),
  SQUIRE_CHAT_CHANNEL_QUESTIONS_PER_MINUTE: 10,
  SQUIRE_CHAT_NOT_LINKED: 'not linked',
  SQUIRE_CHAT_NOT_OWNER: 'not owner',
  SQUIRE_CHAT_QUESTIONS_PER_MINUTE: 10,
  SQUIRE_CHAT_RATE_LIMITED: 'rate limited',
}));

import { answerSlackSquireMention } from '@/lib/chatops/squire/slack';

describe('Squire in a normal (non-incident) channel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.link.mockResolvedValue({ id: 'usr-1', name: 'Ana', email: 'ana@example.com' });
    h.api.mockResolvedValue({ ok: true, ts: '100.1' });
    h.answer.mockResolvedValue({
      name: 'Squire',
      mode: 'basic',
      text: 'Three incidents are open.',
      notices: [],
      citations: [],
      proposals: [],
    });
  });

  it('answers as a general question instead of refusing, still limited to channel-safe tools', async () => {
    const reply = await answerSlackSquireMention({
      __kind: 'SQUIRE_MENTION',
      team_id: 'T1',
      channel_id: 'C1',
      user_id: 'U1',
      text: '<@UBOT> how many incidents are open?',
      ts: '200.1',
    });
    expect(reply?.text).toContain('Three incidents are open.');
    expect(h.answer).toHaveBeenCalledWith(
      expect.objectContaining({ incidentId: null, inChannel: true, userId: 'usr-1' })
    );
  });

  it('still says nothing to a person whose Slack account is not linked', async () => {
    h.link.mockResolvedValue(null);
    const reply = await answerSlackSquireMention({
      __kind: 'SQUIRE_MENTION',
      team_id: 'T1',
      channel_id: 'C1',
      user_id: 'U1',
      text: '<@UBOT> hi',
      ts: '200.1',
    });
    expect(reply).toBeNull();
    expect(h.answer).not.toHaveBeenCalled();
  });
});
