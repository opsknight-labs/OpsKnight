import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  chatOpsIntent: { updateMany: vi.fn(), findUnique: vi.fn() },
}));
const decrypted = vi.hoisted(() => ({
  payload: { response_url: 'https://hooks.slack.com/actions/T1/1/abc' } as Record<string, unknown>,
}));

vi.mock('@/lib/prisma', () => ({ default: db }));
vi.mock('@/lib/encryption', () => ({
  encrypt: vi.fn(),
  decrypt: vi.fn(async () => JSON.stringify(decrypted.payload)),
}));
vi.mock('@/lib/slack-signature', () => ({ toSlackResponseUrl: (u: unknown) => u }));

import { processChatOpsIntent } from '@/lib/chatops/intents';

describe('Slack intent response delivery after response_url expiry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    decrypted.payload = { response_url: 'https://hooks.slack.com/actions/T1/1/abc' };
    global.fetch = vi.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;
    // Effect already recorded: effect claim misses, response claim succeeds.
    db.chatOpsIntent.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
  });

  function intent(ageMs: number) {
    return {
      id: 'i1',
      encryptedPayload: 'enc',
      responsePayload: { text: 'ok' },
      provider: 'SLACK',
      responseMode: 'DEFERRED',
      createdAt: new Date(Date.now() - ageMs),
    };
  }

  it('completes without posting once the response_url has expired', async () => {
    db.chatOpsIntent.findUnique.mockResolvedValue(intent(31 * 60_000));
    await processChatOpsIntent('i1');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(db.chatOpsIntent.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) })
    );
  });

  it('replaces the "Processing" note for a slash command, and falls back if Slack refuses', async () => {
    decrypted.payload = {
      __kind: 'SLASH_COMMAND',
      response_url: 'https://hooks.slack.com/commands/T1/1/abc',
    };
    db.chatOpsIntent.findUnique.mockResolvedValue(intent(60_000));
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 400 })
      .mockResolvedValueOnce({ ok: true }) as unknown as typeof fetch;
    await processChatOpsIntent('i1');
    const bodies = vi
      .mocked(global.fetch)
      .mock.calls.map(call => JSON.parse(call[1]!.body as string));
    expect(bodies).toEqual([{ text: 'ok', replace_original: true }, { text: 'ok' }]);
  });

  it('still posts a fresh response', async () => {
    db.chatOpsIntent.findUnique.mockResolvedValue(intent(60_000));
    await processChatOpsIntent('i1');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
