import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({ enqueue: vi.fn() }));

vi.mock('@/lib/slack-signature', () => ({
  verifySlackSignature: vi.fn().mockResolvedValue({ valid: true }),
}));
vi.mock('@/lib/chatops/intents', () => ({ enqueueChatOpsIntent: h.enqueue }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/chatops/slash-commands', async () => {
  const actual = await vi.importActual<typeof import('@/lib/chatops/slash-commands')>(
    '@/lib/chatops/slash-commands'
  );
  return { ...actual, openSlackDeclareModal: vi.fn() };
});

import { POST } from '@/app/api/slack/commands/route';

const command = (text: string) =>
  POST(
    new NextRequest('https://ops.example.com/api/slack/commands', {
      method: 'POST',
      headers: { 'x-slack-signature': 'v0=x', 'x-slack-request-timestamp': '1' },
      body: new URLSearchParams({
        command: '/incident',
        text,
        team_id: 'T1',
        user_id: 'U1',
        channel_id: 'C1',
        response_url: 'https://hooks.slack.com/commands/T1/1/abc',
      }).toString(),
    })
  );

describe('/incident acknowledgement', () => {
  beforeEach(() => vi.clearAllMocks());

  it('gives a fast command a bare acknowledgement, so its answer is the only message', async () => {
    for (const text of ['who', 'list', 'oncall pay', 'ack', 'help', '']) {
      const response = await command(text);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('');
    }
    expect(h.enqueue).toHaveBeenCalledTimes(6);
  });

  it('keeps a short note for commands that can run for many seconds', async () => {
    for (const text of ['ask what changed?', 'investigate', 'postmortem']) {
      const response = await command(text);
      expect(await response.json()).toMatchObject({
        response_type: 'ephemeral',
        text: expect.stringContaining('Working on it'),
      });
    }
  });
});
