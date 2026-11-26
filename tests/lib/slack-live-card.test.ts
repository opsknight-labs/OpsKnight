import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  incident: { findUnique: vi.fn() },
  user: { findUnique: vi.fn() },
  slackIncidentMessage: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
}));
vi.mock('@/lib/prisma', () => ({ default: db }));
vi.mock('@/lib/env-validation', () => ({ getBaseUrl: () => 'https://ops.example.com' }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  callSlackApi,
  classifySlackError,
  isRetryableSlackTransportError,
  parseRetryAfterMs,
} from '@/lib/slack/api';
import {
  deliverLiveIncidentCard,
  planLiveCardDelivery,
  STALE_CLAIM_MS,
  type SlackLiveCardRequest,
} from '@/lib/slack/live-card';

const install = { token: 'xoxb-test', scopes: ['chat:write', 'channels:join'], workspaceId: 'T1' };
const request = (over: Partial<SlackLiveCardRequest> = {}): SlackLiveCardRequest => ({
  event: 'acknowledged',
  eventKey: 'inc-1:acknowledged:t:dest-1',
  reply: true,
  ...over,
});
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  ({
    status,
    headers: new Headers(headers),
    json: async () => body,
  }) as unknown as Response;

const fetchMock = vi.fn();
const slackCalls = () =>
  fetchMock.mock.calls.map(([url, init]) => ({
    method: String(url).split('/api/')[1],
    body: JSON.parse(String((init as RequestInit).body)),
  }));

function deliver(over: Partial<SlackLiveCardRequest> = {}) {
  return deliverLiveIncidentCard({
    install,
    incidentId: 'inc-1',
    channel: 'C100',
    postChannel: 'C100',
    request: request(over),
    interactive: true,
    maxAttempts: 1,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  db.incident.findUnique.mockResolvedValue({
    id: 'inc-1',
    title: 'DB down',
    description: null,
    status: 'ACKNOWLEDGED',
    urgency: 'HIGH',
    priority: 'P1',
    createdAt: new Date('2026-11-01T10:00:00Z'),
    acknowledgedAt: new Date('2026-11-01T10:04:00Z'),
    resolvedAt: null,
    snoozedUntil: null,
    currentEscalationStep: 0,
    acknowledgedById: 'u1',
    service: { name: 'payments' },
    assignee: null,
  });
  db.user.findUnique.mockResolvedValue({ name: 'Ana', email: 'ana@example.com' });
  db.slackIncidentMessage.update.mockResolvedValue({});
  db.slackIncidentMessage.deleteMany.mockResolvedValue({ count: 1 });
});

describe('planLiveCardDelivery', () => {
  const now = new Date('2026-11-01T10:10:00Z');
  const ref = { channelId: 'C100', ts: '1.1', lastEventKey: null, updatedAt: now };

  it('edits a stored card and replies once per event', () => {
    expect(planLiveCardDelivery(ref, request(), now)).toEqual({ kind: 'update', reply: true });
    expect(
      planLiveCardDelivery({ ...ref, lastEventKey: request().eventKey }, request(), now)
    ).toEqual({ kind: 'update', reply: false });
    expect(planLiveCardDelivery(ref, request({ event: 'updated' }), now)).toEqual({
      kind: 'update',
      reply: false,
    });
  });

  it('claims, waits, takes over or skips when there is no posted card', () => {
    expect(planLiveCardDelivery(null, request(), now)).toEqual({ kind: 'claim' });
    expect(planLiveCardDelivery(null, request({ editOnly: true }), now)).toEqual({ kind: 'skip' });
    const claim = { channelId: null, ts: null, lastEventKey: null, updatedAt: now };
    expect(planLiveCardDelivery(claim, request(), now)).toEqual({ kind: 'busy' });
    const stale = { ...claim, updatedAt: new Date(now.getTime() - STALE_CLAIM_MS - 1) };
    expect(planLiveCardDelivery(stale, request(), now)).toEqual({ kind: 'takeover' });
  });
});

describe('Slack error classification', () => {
  it('separates permanent, rate-limited, retryable and gone-message errors', () => {
    expect(classifySlackError('channel_not_found')).toBe('permanent');
    expect(classifySlackError('token_revoked')).toBe('permanent');
    expect(classifySlackError('ratelimited')).toBe('rate_limited');
    expect(classifySlackError('anything', 429)).toBe('rate_limited');
    expect(classifySlackError('internal_error')).toBe('retryable');
    expect(classifySlackError('HTTP 503', 503)).toBe('retryable');
    expect(classifySlackError('message_not_found')).toBe('message_gone');
    expect(classifySlackError('cant_update_message')).toBe('message_gone');
  });

  it('retries transport failures by status, not by the digit 5 in a message', () => {
    expect(isRetryableSlackTransportError(new Error('invalid_blocks at block 5'))).toBe(false);
    expect(
      isRetryableSlackTransportError(Object.assign(new Error('HTTP 502'), { statusCode: 502 }))
    ).toBe(true);
    expect(isRetryableSlackTransportError(Object.assign(new Error('x'), { statusCode: 404 }))).toBe(
      false
    );
    expect(isRetryableSlackTransportError(new TypeError('fetch failed'))).toBe(true);
    expect(parseRetryAfterMs('7')).toBe(7_000);
    expect(parseRetryAfterMs(null)).toBeUndefined();
  });

  it('returns Retry-After instead of sleeping on a 429', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ ok: false, error: 'ratelimited' }, 429, { 'Retry-After': '12' })
    );
    const result = await callSlackApi('chat.postMessage', 'xoxb', {}, { maxAttempts: 3 });
    expect(result).toEqual({ ok: false, error: 'ratelimited', status: 429, retryAfterMs: 12_000 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('deliverLiveIncidentCard', () => {
  it('posts a new card and stores its reference when none exists', async () => {
    db.slackIncidentMessage.findUnique.mockResolvedValue(null);
    db.slackIncidentMessage.create.mockResolvedValue({ id: 'm1', ts: null, channelId: null });
    fetchMock.mockResolvedValueOnce(json({ ok: true, ts: '9.9', channel: 'C100' }));

    const result = await deliver({ event: 'triggered' });

    expect(result).toMatchObject({ success: true, ts: '9.9', channel: 'C100' });
    expect(slackCalls().map(c => c.method)).toEqual(['chat.postMessage']);
    expect(db.slackIncidentMessage.update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: expect.objectContaining({ ts: '9.9', channelId: 'C100' }),
    });
  });

  it('edits the stored card in place and replies in its thread', async () => {
    db.slackIncidentMessage.findUnique.mockResolvedValue({
      id: 'm1',
      channelId: 'C100',
      ts: '1.1',
      lastEventKey: null,
      updatedAt: new Date(),
    });
    fetchMock.mockResolvedValue(json({ ok: true, ts: '1.1' }));

    const result = await deliver();

    expect(result).toMatchObject({ success: true, updated: true });
    const calls = slackCalls();
    expect(calls.map(c => c.method)).toEqual(['chat.update', 'chat.postMessage']);
    expect(calls[0].body).toMatchObject({ channel: 'C100', ts: '1.1' });
    expect(calls[1].body).toMatchObject({ channel: 'C100', thread_ts: '1.1' });
    expect(calls[1].body.text).toBe('🟠 Acknowledged by Ana · 4m');
    expect(calls[1].body.reply_broadcast).toBeUndefined();
  });

  it('falls back to a new post when the stored card is gone', async () => {
    db.slackIncidentMessage.findUnique.mockResolvedValue({
      id: 'm1',
      channelId: 'C100',
      ts: '1.1',
      lastEventKey: null,
      updatedAt: new Date(),
    });
    db.slackIncidentMessage.updateMany.mockResolvedValue({ count: 1 });
    fetchMock
      .mockResolvedValueOnce(json({ ok: false, error: 'message_not_found' }))
      .mockResolvedValueOnce(json({ ok: true, ts: '2.2', channel: 'C100' }));

    const result = await deliver();

    expect(result).toMatchObject({ success: true, ts: '2.2' });
    expect(slackCalls().map(c => c.method)).toEqual(['chat.update', 'chat.postMessage']);
  });

  it('never posts for edit-only requests without a card', async () => {
    db.slackIncidentMessage.findUnique.mockResolvedValue(null);
    expect(await deliver({ editOnly: true, event: 'reassigned' })).toMatchObject({
      success: true,
      skipped: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lets only one of two racing deliveries create the card', async () => {
    db.slackIncidentMessage.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'm1',
        channelId: null,
        ts: null,
        lastEventKey: null,
        updatedAt: new Date(),
      });
    db.slackIncidentMessage.create.mockRejectedValue(
      Object.assign(new Error('dup'), { code: 'P2002' })
    );

    const result = await deliver({ event: 'triggered' });

    expect(result).toMatchObject({ success: false, errorCode: 'SLACK_CARD_CLAIM_BUSY' });
    expect(result.statusCode).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('joins a public channel once on not_in_channel when the scope allows it', async () => {
    db.slackIncidentMessage.findUnique.mockResolvedValue(null);
    db.slackIncidentMessage.create.mockResolvedValue({ id: 'm1', ts: null, channelId: null });
    fetchMock
      .mockResolvedValueOnce(json({ ok: false, error: 'not_in_channel' }))
      .mockResolvedValueOnce(json({ ok: true }))
      .mockResolvedValueOnce(json({ ok: true, ts: '3.3', channel: 'C100' }));

    const result = await deliver({ event: 'triggered' });

    expect(result).toMatchObject({ success: true, ts: '3.3' });
    expect(slackCalls().map(c => c.method)).toEqual([
      'chat.postMessage',
      'conversations.join',
      'chat.postMessage',
    ]);
  });

  it('reports permanent channel errors with the Slack code and releases the claim', async () => {
    db.slackIncidentMessage.findUnique.mockResolvedValue(null);
    db.slackIncidentMessage.create.mockResolvedValue({ id: 'm1', ts: null, channelId: null });
    fetchMock.mockResolvedValueOnce(json({ ok: false, error: 'is_archived' }));

    const result = await deliver({ event: 'triggered' });

    expect(result).toMatchObject({
      success: false,
      errorCode: 'is_archived',
      error: 'is_archived',
    });
    expect(db.slackIncidentMessage.deleteMany).toHaveBeenCalledWith({
      where: { id: 'm1', ts: null },
    });
  });
});
