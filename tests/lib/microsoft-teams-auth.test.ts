// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { findFirst } = vi.hoisted(() => ({ findFirst: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: { microsoftTeamsConfig: { findFirst } },
}));
vi.mock('@/lib/encryption', () => ({
  decrypt: vi.fn(async () => 'client-secret'),
  decryptStoredSecret: vi.fn(async () => 'client-secret'),
}));

import {
  __clearBotJwksCacheForTests,
  __fetchBotJwksForTests,
  __isBotSigningKeyEndorsedForTests,
  assertMicrosoftTeamsActivityAuth,
  BOT_JWKS_FORCED_REFRESH_MIN_INTERVAL_MS,
  BOT_JWT_CLOCK_TOLERANCE_SECONDS,
} from '@/lib/microsoft-teams/auth';

describe('Microsoft Teams Bot Connector signing-key endorsements', () => {
  const jwks = {
    keys: [
      { kid: 'teams-key', endorsements: ['msteams', 'webchat'] },
      { kid: 'webchat-key', endorsements: ['webchat'] },
    ],
  };

  it('accepts only the channel endorsed by the key that verified the JWT', () => {
    expect(__isBotSigningKeyEndorsedForTests(jwks, 'teams-key', 'msteams')).toBe(true);
    expect(__isBotSigningKeyEndorsedForTests(jwks, 'webchat-key', 'msteams')).toBe(false);
  });

  it('fails closed for missing keys, channel IDs, or endorsement metadata', () => {
    expect(__isBotSigningKeyEndorsedForTests(jwks, 'missing', 'msteams')).toBe(false);
    expect(__isBotSigningKeyEndorsedForTests(jwks, 'teams-key', '')).toBe(false);
    expect(
      __isBotSigningKeyEndorsedForTests({ keys: [{ kid: 'teams-key' }] }, 'teams-key', 'msteams')
    ).toBe(false);
  });
});

const CLIENT_ID = '11111111-2222-3333-4444-555555555555';

function mockJwksFetch(getKeys: () => unknown) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const url = String(input);
    if (url.includes('openidconfiguration')) {
      return new Response(JSON.stringify({ jwks_uri: 'https://login.botframework.com/keys' }));
    }
    return new Response(JSON.stringify(getKeys()));
  });
}

describe('Bot Framework JWKS cache', () => {
  beforeEach(() => {
    __clearBotJwksCacheForTests();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-27T10:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('passes a timeout signal to every JWKS request', async () => {
    const fetchSpy = mockJwksFetch(() => ({ keys: [] }));
    await __fetchBotJwksForTests();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    for (const call of fetchSpy.mock.calls) {
      expect((call[1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('shares one in-flight fetch between concurrent callers', async () => {
    const fetchSpy = mockJwksFetch(() => ({ keys: [] }));
    await Promise.all([1, 2, 3, 4, 5].map(() => __fetchBotJwksForTests()));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('throttles forced refreshes to once per 5 minutes', async () => {
    const fetchSpy = mockJwksFetch(() => ({ keys: [] }));
    await __fetchBotJwksForTests();
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    await __fetchBotJwksForTests(true); // first forced refresh is allowed
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    await __fetchBotJwksForTests(true);
    await __fetchBotJwksForTests(true);
    expect(fetchSpy).toHaveBeenCalledTimes(4);

    vi.setSystemTime(Date.now() + BOT_JWKS_FORCED_REFRESH_MIN_INTERVAL_MS + 1);
    await __fetchBotJwksForTests(true);
    expect(fetchSpy).toHaveBeenCalledTimes(6);
    expect(BOT_JWKS_FORCED_REFRESH_MIN_INTERVAL_MS).toBe(5 * 60 * 1000);
  });

  it('serves cached keys when a refresh fails, and throws only with no cache', async () => {
    const fetchSpy = mockJwksFetch(() => ({ keys: [{ kid: 'a' }] }));
    const first = await __fetchBotJwksForTests();
    fetchSpy.mockRejectedValue(new Error('network down'));
    vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1000); // past the 1h TTL
    await expect(__fetchBotJwksForTests()).resolves.toBe(first);

    __clearBotJwksCacheForTests();
    await expect(__fetchBotJwksForTests()).rejects.toThrow('network down');
  });
});

describe('Bot Framework JWT verification', () => {
  let signToken: (input: { kid: string; expOffsetSeconds: number }) => Promise<string>;
  let publicJwk: Record<string, unknown>;

  beforeEach(async () => {
    __clearBotJwksCacheForTests();
    findFirst.mockResolvedValue({ id: 'cfg', clientId: CLIENT_ID, clientSecret: 'enc' });
    const jose = await import('jose');
    const { publicKey, privateKey } = await jose.generateKeyPair('RS256', { extractable: true });
    publicJwk = {
      ...(await jose.exportJWK(publicKey)),
      kid: 'teams-key',
      alg: 'RS256',
      use: 'sig',
      endorsements: ['msteams'],
    };
    signToken = async ({ kid, expOffsetSeconds }) => {
      const now = Math.floor(Date.now() / 1000);
      return new jose.SignJWT({ serviceurl: 'https://smba.trafficmanager.net/amer/' })
        .setProtectedHeader({ alg: 'RS256', kid })
        .setIssuer('https://api.botframework.com')
        .setAudience(CLIENT_ID)
        .setIssuedAt(now - 3_600)
        .setNotBefore(now - 3_600)
        .setExpirationTime(now + expOffsetSeconds)
        .sign(privateKey);
    };
  });
  afterEach(() => vi.restoreAllMocks());

  const request = (token: string) =>
    new Request('https://opsknight.test/api/microsoft-teams/messages', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });

  it('accepts a token up to the 300s clock tolerance after expiry', async () => {
    expect(BOT_JWT_CLOCK_TOLERANCE_SECONDS).toBe(300);
    mockJwksFetch(() => ({ keys: [publicJwk] }));
    const skewed = await signToken({ kid: 'teams-key', expOffsetSeconds: -120 });
    await expect(
      assertMicrosoftTeamsActivityAuth(request(skewed), { expectedChannelId: 'msteams' })
    ).resolves.toEqual({ serviceUrl: 'https://smba.trafficmanager.net/amer/', appId: CLIENT_ID });
  });

  it('rejects a token expired beyond the tolerance', async () => {
    mockJwksFetch(() => ({ keys: [publicJwk] }));
    const expired = await signToken({ kid: 'teams-key', expOffsetSeconds: -400 });
    await expect(
      assertMicrosoftTeamsActivityAuth(request(expired), { expectedChannelId: 'msteams' })
    ).resolves.toBeNull();
  });

  it('keeps the audience and channel-endorsement checks', async () => {
    mockJwksFetch(() => ({ keys: [{ ...publicJwk, endorsements: ['webchat'] }] }));
    const token = await signToken({ kid: 'teams-key', expOffsetSeconds: 600 });
    await expect(
      assertMicrosoftTeamsActivityAuth(request(token), { expectedChannelId: 'msteams' })
    ).resolves.toBeNull();
  });

  it('does not refetch the JWKS for every forged token with an unknown kid', async () => {
    const fetchSpy = mockJwksFetch(() => ({ keys: [publicJwk] }));
    const forged = await signToken({ kid: 'unknown-kid', expOffsetSeconds: 600 });
    for (let i = 0; i < 5; i++) {
      await expect(
        assertMicrosoftTeamsActivityAuth(request(forged), { expectedChannelId: 'msteams' })
      ).resolves.toBeNull();
    }
    // Initial load (2 requests) + one throttled forced refresh (2 requests).
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });
});
