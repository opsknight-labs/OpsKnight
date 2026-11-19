import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const db = vi.hoisted(() => {
  const tx = {
    slackPinnedMessage: { findUnique: vi.fn(), create: vi.fn() },
    incidentNote: { create: vi.fn() },
    incidentEvent: { create: vi.fn() },
  };
  return {
    tx,
    incident: { findFirst: vi.fn() },
    slackPinnedMessage: { findUnique: vi.fn() },
    user: { findFirst: vi.fn() },
    $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };
});
const retryFetch = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ default: db }));
vi.mock('@/lib/slack', () => ({ getSlackBotToken: vi.fn().mockResolvedValue('xoxb') }));
vi.mock('@/lib/retry', () => ({ retryFetch }));
vi.mock('@/lib/slack-signature', () => ({
  verifySlackSignature: vi.fn().mockResolvedValue({ valid: true }),
}));

import { POST } from '@/app/api/slack/events/route';

const json = (body: unknown) => ({ json: async () => body });

describe('Slack pin reaction on a thread reply', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.incident.findFirst.mockResolvedValue({ id: 'inc-1', title: 't', serviceId: 'svc-1' });
    db.slackPinnedMessage.findUnique.mockResolvedValue(null);
    db.tx.slackPinnedMessage.findUnique.mockResolvedValue(null);
    db.user.findFirst.mockResolvedValue(null);
  });

  it('saves the reply text, not the latest top-level channel message', async () => {
    retryFetch.mockImplementation(async (url: string) => {
      if (url.includes('conversations.history'))
        return json({ ok: true, messages: [{ ts: '200.0', text: 'unrelated top-level' }] });
      if (url.includes('conversations.replies'))
        return json({
          ok: true,
          messages: [
            { ts: '100.0', text: 'thread parent' },
            { ts: '150.0', text: 'the reply' },
          ],
        });
      return json({ ok: true, user: { name: 'alice', profile: {} } });
    });

    await POST(
      new NextRequest('http://localhost/api/slack/events', {
        method: 'POST',
        body: JSON.stringify({
          type: 'event_callback',
          team_id: 'T1',
          event: {
            type: 'reaction_added',
            reaction: 'pushpin',
            user: 'U1',
            item: { channel: 'C1', ts: '150.0' },
          },
        }),
      })
    );

    const content = db.tx.incidentNote.create.mock.calls[0][0].data.content as string;
    expect(content).toContain('the reply');
    expect(content).not.toContain('unrelated top-level');
  });
});
