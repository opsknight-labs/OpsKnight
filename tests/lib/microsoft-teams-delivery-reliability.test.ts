import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('@/lib/db-locks', () => ({ acquireAdvisoryLock: vi.fn(async () => undefined) }));
vi.mock('@/lib/provider-admission', () => ({
  acquireProviderAdmission: vi.fn(),
  acquireProviderConcurrency: vi.fn(),
  releaseProviderConcurrency: vi.fn(),
  deferProviderAdmission: vi.fn(),
}));
vi.mock('@/lib/audit', () => ({ emitAuditEvent: vi.fn(async () => undefined) }));
vi.mock('@/lib/microsoft-teams/auth', () => ({
  getMicrosoftTeamsConfig: vi.fn(async () => ({
    config: { clientId: 'client-1', tenantId: 'tenant-1' },
    clientSecret: 'secret',
  })),
}));

import {
  teamsAmbiguousCreateExpired,
  teamsCreateGatewayNotApplied,
  teamsNotifyToggleDecision,
  teamsThreadReplyText,
  TEAMS_AMBIGUOUS_REPOST_AFTER_MS,
} from '@/lib/microsoft-teams/delivery';
import {
  __clearBotTokenCacheForTests,
  classifyTeamsActivityUpdateFailure,
  parseTeamsRetryAfterMs,
  updateMicrosoftTeamsChannelCard,
} from '@/lib/microsoft-teams/client';

describe('Teams notify toggle vs in-place edit', () => {
  it('edits an existing card even when the event toggle is off', () => {
    expect(
      teamsNotifyToggleDecision({
        eventType: 'acknowledged',
        hasExistingCard: true,
        serviceNotifyOnAck: false,
      })
    ).toBe('edit_only');
    expect(
      teamsNotifyToggleDecision({
        eventType: 'resolved',
        hasExistingCard: true,
        serviceNotifyOnResolved: false,
      })
    ).toBe('edit_only');
  });

  it('posts nothing new when the toggle is off and there is no card', () => {
    expect(
      teamsNotifyToggleDecision({
        eventType: 'triggered',
        hasExistingCard: false,
        serviceNotifyOnTriggered: false,
      })
    ).toBe('skip');
  });

  it('delivers (edit + thread reply) when the toggle is on or unset', () => {
    expect(teamsNotifyToggleDecision({ eventType: 'acknowledged', hasExistingCard: true })).toBe(
      'deliver'
    );
    expect(
      teamsNotifyToggleDecision({
        eventType: 'updated',
        hasExistingCard: true,
        serviceNotifyOnAck: false,
        serviceNotifyOnResolved: false,
        serviceNotifyOnTriggered: false,
      })
    ).toBe('deliver');
  });
});

describe('Teams thread replies for state changes', () => {
  it('writes ack, resolve-with-note and escalation replies', () => {
    expect(
      teamsThreadReplyText({
        eventType: 'acknowledged',
        incident: { status: 'ACKNOWLEDGED', acknowledgedBy: 'Carol' },
      })
    ).toBe('Acknowledged by Carol');
    expect(
      teamsThreadReplyText({
        eventType: 'resolved',
        incident: { status: 'RESOLVED', resolvedBy: 'Eve' },
        resolutionNote: 'Rolled back the deploy',
      })
    ).toBe('Resolved by Eve: Rolled back the deploy');
    expect(
      teamsThreadReplyText({
        eventType: 'escalated',
        incident: { status: 'OPEN', escalation: { level: 2, target: 'Bob' } },
      })
    ).toBe('Escalated to level 2 · paging Bob');
  });

  it('stays quiet for a superseded state or a plain update', () => {
    expect(
      teamsThreadReplyText({ eventType: 'acknowledged', incident: { status: 'RESOLVED' } })
    ).toBeNull();
    expect(teamsThreadReplyText({ eventType: 'updated', incident: { status: 'OPEN' } })).toBeNull();
  });
});

describe('Teams create ambiguity bounds', () => {
  it('treats only gateway errors as not applied', () => {
    expect([502, 503, 504].every(teamsCreateGatewayNotApplied)).toBe(true);
    expect(teamsCreateGatewayNotApplied(500)).toBe(false);
    expect(teamsCreateGatewayNotApplied(undefined)).toBe(false);
  });

  it('re-posts only after the reconciliation window', () => {
    const now = new Date('2026-11-26T10:00:00Z');
    expect(teamsAmbiguousCreateExpired(null, now)).toBe(false);
    expect(teamsAmbiguousCreateExpired(new Date(now.getTime() - 60_000), now)).toBe(false);
    expect(
      teamsAmbiguousCreateExpired(new Date(now.getTime() - TEAMS_AMBIGUOUS_REPOST_AFTER_MS), now)
    ).toBe(true);
  });
});

describe('Teams activity update classification', () => {
  it('maps 429 with Retry-After to RATE_LIMITED + retryAfterMs', () => {
    expect(classifyTeamsActivityUpdateFailure(429, '7', '')).toMatchObject({
      errorCode: 'RATE_LIMITED',
      statusCode: 429,
      retryAfterMs: 7000,
    });
    const at = new Date(Date.now() + 30_000).toUTCString();
    expect(parseTeamsRetryAfterMs(at)).toBeGreaterThan(20_000);
    expect(parseTeamsRetryAfterMs('garbage')).toBeUndefined();
  });

  it('maps a gone message to MESSAGE_NOT_FOUND and 5xx to retryable http_5xx', () => {
    expect(classifyTeamsActivityUpdateFailure(404, null, '')).toMatchObject({
      errorCode: 'MESSAGE_NOT_FOUND',
    });
    expect(classifyTeamsActivityUpdateFailure(403, null, 'Activity does not exist')).toMatchObject({
      errorCode: 'MESSAGE_NOT_FOUND',
      statusCode: 404,
    });
    expect(classifyTeamsActivityUpdateFailure(403, null, 'Forbidden')).toMatchObject({
      errorCode: 'AUTH_EXPIRED',
    });
    expect(classifyTeamsActivityUpdateFailure(502, null, '')).toMatchObject({
      errorCode: 'http_502',
      statusCode: 502,
    });
  });
});

describe('updateBotActivity transport', () => {
  const fetchMock = vi.fn();
  const updateArgs = {
    tenantId: 'tenant-1',
    channelId: 'channel-1',
    conversationId: '19:abc@thread.tacv2;messageid=1',
    messageId: '1',
    incidentId: 'inc-1',
    serviceUrl: 'https://smba.trafficmanager.net/amer/',
    card: { type: 'AdaptiveCard', _opsknightMeta: { summary: '[P1] Acknowledged: DB down' } },
  };
  const tokenResponse = () =>
    new Response(JSON.stringify({ access_token: 'bot-token', expires_in: 3600 }), { status: 200 });

  beforeEach(() => {
    __clearBotTokenCacheForTests();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('returns a 429 with its Retry-After instead of throwing, after one PUT', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '12' } }));
    const result = await updateMicrosoftTeamsChannelCard(updateArgs);
    expect(result).toMatchObject({
      success: false,
      errorCode: 'RATE_LIMITED',
      retryAfterMs: 12_000,
    });
    const puts = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT');
    expect(puts).toHaveLength(1);
    expect(JSON.parse(puts[0][1].body).summary).toBe('[P1] Acknowledged: DB down');
  });

  it('reports a deleted activity as MESSAGE_NOT_FOUND so delivery re-posts it', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response('', { status: 404 }));
    await expect(updateMicrosoftTeamsChannelCard(updateArgs)).resolves.toMatchObject({
      errorCode: 'MESSAGE_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('turns a network failure into a retryable result', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(updateMicrosoftTeamsChannelCard(updateArgs)).resolves.toMatchObject({
      success: false,
      errorCode: 'NETWORK_ERROR',
    });
  });
});
