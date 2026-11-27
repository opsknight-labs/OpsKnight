import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSlackBotScopes: vi.fn(),
  getSlackBotToken: vi.fn(),
  userFindUnique: vi.fn(),
  incidentFindUnique: vi.fn(),
}));

vi.mock('@/lib/slack', () => ({
  getSlackBotScopes: mocks.getSlackBotScopes,
  getSlackBotToken: mocks.getSlackBotToken,
}));
vi.mock('@/lib/prisma', () => ({
  default: {
    user: { findUnique: mocks.userFindUnique },
    incident: { findUnique: mocks.incidentFindUnique },
  },
}));
vi.mock('@/lib/env-validation', () => ({ getBaseUrl: () => 'https://ok.example.com/' }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { isSlackDmAvailable, resetSlackDmCache, sendSlackIncidentDm } from '@/lib/slack/dm';
import { SLACK_BOT_SCOPES, SLACK_REQUIRED_BOT_SCOPES } from '@/lib/slack/app-manifest';

function slackResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  resetSlackDmCache();
  vi.stubGlobal('fetch', fetchMock);
  mocks.getSlackBotScopes.mockResolvedValue([...SLACK_BOT_SCOPES]);
  mocks.getSlackBotToken.mockResolvedValue('xoxb-test');
  mocks.userFindUnique.mockResolvedValue({ email: 'Ana@Example.com', status: 'ACTIVE' });
  mocks.incidentFindUnique.mockResolvedValue({
    id: 'inc_1',
    title: 'API down',
    status: 'OPEN',
    urgency: 'HIGH',
    priority: 'P1',
    createdAt: new Date('2026-12-02T10:00:00Z'),
    service: { name: 'API' },
    assignee: null,
  });
});

const input = { userId: 'u1', incidentId: 'inc_1', eventType: 'triggered' as const };

describe('Slack DM paging', () => {
  it('is unavailable for installs without im:write', async () => {
    mocks.getSlackBotScopes.mockResolvedValue([...SLACK_REQUIRED_BOT_SCOPES]);
    await expect(isSlackDmAvailable()).resolves.toBe(false);
    const result = await sendSlackIncidentDm(input);
    expect(result).toMatchObject({ success: false, statusCode: 422 });
    expect(result.error).toMatch(/not configured/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('looks up by email, opens the DM and posts the card with absolute links', async () => {
    fetchMock
      .mockResolvedValueOnce(slackResponse({ ok: true, user: { id: 'U1', profile: { is_email_confirmed: true } } }))
      .mockResolvedValueOnce(slackResponse({ ok: true, channel: { id: 'D1' } }))
      .mockResolvedValueOnce(slackResponse({ ok: true, ts: '123.456' }));

    const result = await sendSlackIncidentDm(input);

    expect(result).toEqual({ success: true, providerMessageId: '123.456' });
    expect(fetchMock.mock.calls.map(call => String(call[0]))).toEqual([
      'https://slack.com/api/users.lookupByEmail',
      'https://slack.com/api/conversations.open',
      'https://slack.com/api/chat.postMessage',
    ]);
    expect(String(fetchMock.mock.calls[0][1].body)).toBe('email=ana%40example.com');
    const posted = JSON.parse(fetchMock.mock.calls[2][1].body as string);
    expect(posted.channel).toBe('D1');
    expect(JSON.stringify(posted.blocks)).toContain('https://ok.example.com/incidents/inc_1');
    expect(JSON.stringify(posted.blocks)).toContain('ack_incident');
  });

  it('caches the Slack user id between pages', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith('users.lookupByEmail')
        ? slackResponse({ ok: true, user: { id: 'U1', profile: {} } })
        : url.endsWith('conversations.open')
          ? slackResponse({ ok: true, channel: { id: 'D1' } })
          : slackResponse({ ok: true, ts: '1.2' })
    );
    await sendSlackIncidentDm(input);
    await sendSlackIncidentDm(input);
    const lookups = fetchMock.mock.calls.filter(call => String(call[0]).endsWith('lookupByEmail'));
    expect(lookups).toHaveLength(1);
  });

  it('treats an unknown or unconfirmed Slack user as permanent', async () => {
    fetchMock.mockResolvedValueOnce(slackResponse({ ok: false, error: 'users_not_found' }));
    expect(await sendSlackIncidentDm(input)).toMatchObject({ statusCode: 400, errorCode: 'users_not_found' });

    fetchMock.mockResolvedValueOnce(
      slackResponse({ ok: true, user: { id: 'U2', profile: { is_email_confirmed: false } } })
    );
    expect(await sendSlackIncidentDm(input)).toMatchObject({ statusCode: 404, errorCode: 'users_not_found' });
  });

  it('reports 429 with Retry-After so the plane can defer', async () => {
    fetchMock.mockResolvedValueOnce(slackResponse({ ok: false }, { status: 429, headers: { 'Retry-After': '30' } }));
    expect(await sendSlackIncidentDm(input)).toMatchObject({
      success: false,
      statusCode: 429,
      retryAfterMs: 30_000,
    });
  });

  it('reports 5xx and network failures as retryable', async () => {
    fetchMock.mockResolvedValueOnce(slackResponse({}, { status: 503 }));
    expect(await sendSlackIncidentDm(input)).toMatchObject({ success: false, statusCode: 503 });

    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    const network = await sendSlackIncidentDm(input);
    expect(network.statusCode).toBeUndefined();
    expect(network.error).toMatch(/network error/);
  });

  it('skips inactive recipients without calling Slack', async () => {
    mocks.userFindUnique.mockResolvedValue({ email: 'a@b.c', status: 'DISABLED' });
    expect(await sendSlackIncidentDm(input)).toMatchObject({ success: true, skipped: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
