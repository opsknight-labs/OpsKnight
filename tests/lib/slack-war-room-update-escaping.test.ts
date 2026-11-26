import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  slackApiCall: vi.fn(),
  incidentFindUnique: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({
  default: { incident: { findUnique: mocks.incidentFindUnique } },
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/env-validation', () => ({ getBaseUrl: () => 'https://ok.example.com' }));
vi.mock('@/lib/slack', () => ({ getSlackBotToken: vi.fn().mockResolvedValue('xoxb-token') }));
vi.mock('@/lib/war-room/slack-compatibility', () => ({
  findSlackWarRoomAuthority: vi
    .fn()
    .mockResolvedValue({ providerChannelId: 'C123', state: 'ACTIVE' }),
  projectSlackWarRoomToLegacyIncident: vi.fn(),
}));
vi.mock('@/lib/war-room/providers/slack/client', () => ({ slackApiCall: mocks.slackApiCall }));

import { postSlackWarRoomUpdate } from '@/lib/war-room/providers/slack/lifecycle';

describe('postSlackWarRoomUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.incidentFindUnique.mockResolvedValue({ serviceId: 'svc-1' });
    mocks.slackApiCall.mockResolvedValue({ ok: true });
  });

  it('defuses channel, user-group and user mentions typed into a note', async () => {
    const note =
      '📝 *Note by Ada:*\n> hi <!channel>\n> <!subteam^S123> <@U123|x> <https://evil|click>';

    await postSlackWarRoomUpdate('inc-1', note);

    const text = mocks.slackApiCall.mock.calls[0][2].text as string;
    expect(text).not.toContain('<');
    expect(text).toContain('&lt;!channel>');
    expect(text).toContain('&lt;!subteam^S123>');
    expect(text.startsWith('📝 *Note by Ada:*\n> hi')).toBe(true);
  });
});
