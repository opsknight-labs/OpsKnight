import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mock shared between factory and test helper
const h = vi.hoisted(() => ({
  retryFetch: vi.fn(),
}));

vi.mock('@/lib/retry', () => ({
  retryFetch: h.retryFetch,
  isRetryableHttpError: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { findSlackWarRoomForTerminalCleanup } from '@/lib/war-room/providers/slack/client';

function mockListJson(page: { channels: Array<{ id: string; name: string }>; next_cursor?: string }) {
  return {
    ok: true,
    channels: page.channels,
    response_metadata: page.next_cursor ? { next_cursor: page.next_cursor } : undefined,
  };
}

describe('findSlackWarRoomForTerminalCleanup — direct helper (conversations.info classification)', () => {
  beforeEach(() => {
    h.retryFetch.mockReset();
  });

  async function withMocks(opts: {
    listPages: Array<{ channels: Array<{ id: string; name: string }>; next_cursor?: string } | { ok: false; error: string; httpStatus?: number }>;
    infoByChannelId: Record<string, { ok: boolean; error?: string; channel?: { topic?: { value?: string }; purpose?: { value?: string } }; transportFailure?: boolean }>;
  }) {
    let listIdx = 0;
    h.retryFetch.mockImplementation(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String((init as { body?: string }).body ?? '{}')) as Record<string, unknown>;
      const isList = url.includes('conversations.list');
      const isInfo = url.includes('conversations.info');

      if (isList) {
        const page = opts.listPages[listIdx++];
        if (!page) {
          return { json: async () => ({ ok: true, channels: [] }) } as unknown as Response;
        }
        if ((page as { ok: false }).ok === false) {
          const e = page as { ok: false; error: string; httpStatus?: number };
          // For retry path, a non-ok JSON is returned; slackApiCall will see !result.ok
          // For direct fetch-error simulation (5xx), we'd need httpStatus + non-ok response,
          // but for list failures rate_limited etc. the JSON ok:false is sufficient.
          // Simulate HTTP 429 JSON style for rate_limited
          return {
            json: async () => ({ ok: false, error: e.error }),
          } as unknown as Response;
        }
        const p = page as { channels: Array<{ id: string; name: string }>; next_cursor?: string };
        return { json: async () => mockListJson(p) } as unknown as Response;
      }

      if (isInfo) {
        const cid = String(body.channel ?? '');
        const entry = opts.infoByChannelId[cid];
        if (!entry) {
          return { json: async () => ({ ok: false, error: 'channel_not_found' }) } as unknown as Response;
        }
        if (entry.transportFailure) {
          throw new Error('fetch failed: network error');
        }
        if (!entry.ok) {
          return { json: async () => ({ ok: false, error: entry.error }) } as unknown as Response;
        }
        const topic = entry.channel?.topic?.value ?? '';
        const purpose = entry.channel?.purpose?.value ?? '';
        return {
          json: async () => ({
            ok: true,
            channel: { topic: { value: topic }, purpose: { value: purpose } },
          }),
        } as unknown as Response;
      }

      return { json: async () => ({ ok: false, error: 'unknown_method' }) } as unknown as Response;
    });

    return findSlackWarRoomForTerminalCleanup('xoxb-mock', '[OKWR:inc-1:g1]', null);
  }

  it('conversations.list succeeds + conversations.info → missing_scope => UNAVAILABLE PERMISSION_DENIED (never NOT_FOUND)', async () => {
    const result = await withMocks({
      listPages: [{ channels: [{ id: 'C1', name: 'inc-1-war-room' }] }],
      infoByChannelId: { C1: { ok: false, error: 'missing_scope' } },
    });
    expect(result.status).toBe('UNAVAILABLE');
    if (result.status === 'UNAVAILABLE') expect(result.code).toBe('PERMISSION_DENIED');
  });

  it('conversations.info → restricted_action => UNAVAILABLE PERMISSION_DENIED', async () => {
    const result = await withMocks({
      listPages: [{ channels: [{ id: 'C1', name: 'x' }] }],
      infoByChannelId: { C1: { ok: false, error: 'restricted_action' } },
    });
    expect(result.status).toBe('UNAVAILABLE');
    if (result.status === 'UNAVAILABLE') expect(result.code).toBe('PERMISSION_DENIED');
  });

  it('conversations.info → not_allowed => PERMISSION_DENIED', async () => {
    const result = await withMocks({
      listPages: [{ channels: [{ id: 'C1', name: 'x' }] }],
      infoByChannelId: { C1: { ok: false, error: 'not_allowed' } },
    });
    expect(result.status).toBe('UNAVAILABLE');
    if (result.status === 'UNAVAILABLE') expect(result.code).toBe('PERMISSION_DENIED');
  });

  it('conversations.info → channel_not_found / is_archived are skippable => NOT_FOUND', async () => {
    const result = await withMocks({
      listPages: [{ channels: [{ id: 'C1', name: 'inc-1-war-room' }] }],
      infoByChannelId: { C1: { ok: false, error: 'channel_not_found' } },
    });
    expect(result).toEqual({ status: 'NOT_FOUND' });
  });

  it('conversations.info is_archived is skippable => NOT_FOUND', async () => {
    const result = await withMocks({
      listPages: [{ channels: [{ id: 'C1', name: 'x' }] }],
      infoByChannelId: { C1: { ok: false, error: 'is_archived' } },
    });
    expect(result).toEqual({ status: 'NOT_FOUND' });
  });

  it('conversations.info transportFailure => UNAVAILABLE TRANSIENT (cannot prove absence)', async () => {
    const result = await withMocks({
      listPages: [{ channels: [{ id: 'C1', name: 'inc-1-war-room' }] }],
      infoByChannelId: { C1: { ok: false, error: 'fetch failed', transportFailure: true } },
    });
    expect(result.status).toBe('UNAVAILABLE');
    if (result.status === 'UNAVAILABLE') expect(result.code).toBe('TRANSIENT');
  });

  it('conversations.list rate_limited => UNAVAILABLE RATE_LIMITED', async () => {
    const result = await withMocks({
      listPages: [{ ok: false, error: 'rate_limited' } as never],
      infoByChannelId: {},
    });
    expect(result.status).toBe('UNAVAILABLE');
    if (result.status === 'UNAVAILABLE') expect(result.code).toBe('RATE_LIMITED');
  });

  it('marker FOUND via topic still returns FOUND', async () => {
    const result = await withMocks({
      listPages: [{ channels: [{ id: 'C1', name: 'some-channel' }] }],
      infoByChannelId: { C1: { ok: true, channel: { topic: { value: 'hello [OKWR:inc-1:g1] world' } } } },
    });
    expect(result.status).toBe('FOUND');
    if (result.status === 'FOUND') expect(result.channel.id).toBe('C1');
  });
});
