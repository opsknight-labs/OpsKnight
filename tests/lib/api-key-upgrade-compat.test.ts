import { createHash, createHmac, randomBytes, scryptSync } from 'crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type StoredToken = {
  id: string;
  tokenHash: string;
  revokedAt: Date | null;
  statusPageId?: string;
  lastUsedAt?: Date | null;
};

const store = vi.hoisted(() => ({
  apiKeys: [] as StoredToken[],
  statusTokens: [] as StoredToken[],
}));

function matchesHash(row: StoredToken, tokenHash: unknown) {
  if (typeof tokenHash === 'string') return row.tokenHash === tokenHash;
  const candidates = (tokenHash as { in?: string[] } | undefined)?.in ?? [];
  return candidates.includes(row.tokenHash);
}

vi.mock('@/lib/prisma', () => {
  const findIn =
    (rows: () => StoredToken[]) =>
    async ({ where }: { where: Record<string, unknown> }) =>
      rows().find(
        row =>
          row.revokedAt === null &&
          matchesHash(row, where.tokenHash) &&
          (where.statusPageId === undefined || row.statusPageId === where.statusPageId)
      ) ?? null;
  const updateIn =
    (rows: () => StoredToken[]) =>
    async ({ where, data }: { where: { id: string }; data: Partial<StoredToken> }) => {
      const row = rows().find(candidate => candidate.id === where.id)!;
      Object.assign(row, data);
      return row;
    };
  return {
    default: {
      apiKey: {
        findFirst: vi.fn(findIn(() => store.apiKeys)),
        update: vi.fn(updateIn(() => store.apiKeys)),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      statusPageApiToken: {
        findFirst: vi.fn(findIn(() => store.statusTokens)),
        update: vi.fn(updateIn(() => store.statusTokens)),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    },
  };
});
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async () => ({ allowed: true, resetAt: Date.now() + 60_000 }),
}));

import prisma from '@/lib/prisma';
import { authenticateApiKey } from '@/lib/api-auth';
import { authorizeStatusApiRequest } from '@/lib/status-api-auth';
import { hashTokenV2 } from '@/lib/api-keys';

const OLD_NEXTAUTH_SECRET = 'retained-1x-nextauth-secret-value-0123456789abcdef';
const NEW_API_KEY_SECRET = 'independent-2x-api-key-secret-value-fedcba9876543210';
const OLD_ENCRYPTION_KEY = 'a1'.repeat(32);
const ENV_KEYS = ['NEXTAUTH_SECRET', 'API_KEY_SECRET', 'ENCRYPTION_KEY'] as const;

function legacy1xToken() {
  return `ok_${randomBytes(32).toString('base64url')}`;
}

function scryptHex(token: string, salt: string) {
  return scryptSync(token, salt, 32).toString('hex');
}

function hmacV2(token: string, secret: string) {
  return createHmac('sha256', secret).update(`opsknight:api-key:v2:${token}`).digest('hex');
}

function apiRequest(token: string) {
  return new NextRequest('https://ops.example/api/incidents', {
    headers: { authorization: `Bearer ${token}` },
  });
}

async function statusRequest(token: string) {
  return authorizeStatusApiRequest(
    new NextRequest('https://status.example/api/status', {
      headers: { authorization: `Bearer ${token}` },
    }),
    'page-a',
    { requireToken: true, rateLimitEnabled: false }
  );
}

describe('1.x -> 2.0 API credential compatibility', () => {
  const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    process.env.NEXTAUTH_SECRET = OLD_NEXTAUTH_SECRET;
    process.env.API_KEY_SECRET = NEW_API_KEY_SECRET;
    delete process.env.ENCRYPTION_KEY;
    store.apiKeys.length = 0;
    store.statusTokens.length = 0;
    vi.clearAllMocks();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it('authenticates a 1.x API key salted with the retained NEXTAUTH_SECRET and migrates it', async () => {
    const token = legacy1xToken();
    store.apiKeys.push({ id: 'key-1', tokenHash: scryptHex(token, OLD_NEXTAUTH_SECRET), revokedAt: null });

    const first = await authenticateApiKey(apiRequest(token));
    expect(first?.id).toBe('key-1');
    expect(store.apiKeys[0].tokenHash).toBe(hmacV2(token, NEW_API_KEY_SECRET));
    expect(store.apiKeys[0].tokenHash).toBe(hashTokenV2(token));

    vi.mocked(prisma.apiKey.findFirst).mockClear();
    const second = await authenticateApiKey(apiRequest(token));
    expect(second?.id).toBe('key-1');
    expect(prisma.apiKey.findFirst).toHaveBeenCalledTimes(1);
    expect(vi.mocked(prisma.apiKey.findFirst).mock.calls[0][0]).toMatchObject({
      where: { tokenHash: hmacV2(token, NEW_API_KEY_SECRET) },
    });
  });

  it('authenticates a 1.x API key that was salted with a 1.x API_KEY_SECRET', async () => {
    const token = legacy1xToken();
    store.apiKeys.push({ id: 'key-1', tokenHash: scryptHex(token, NEW_API_KEY_SECRET), revokedAt: null });

    await expect(authenticateApiKey(apiRequest(token))).resolves.toMatchObject({ id: 'key-1' });
    expect(store.apiKeys[0].tokenHash).toBe(hashTokenV2(token));
  });

  it('authenticates 1.x keys salted with the ENCRYPTION_KEY-derived NextAuth secret', async () => {
    const token = legacy1xToken();
    const derived = createHash('sha256')
      .update(`opsknight:nextauth-secret:v1:${OLD_ENCRYPTION_KEY}`)
      .digest('base64');
    process.env.ENCRYPTION_KEY = OLD_ENCRYPTION_KEY;
    store.apiKeys.push({ id: 'key-1', tokenHash: scryptHex(token, derived), revokedAt: null });

    await expect(authenticateApiKey(apiRequest(token))).resolves.toMatchObject({ id: 'key-1' });
    expect(store.apiKeys[0].tokenHash).toBe(hashTokenV2(token));
  });

  it('authenticates 1.x keys salted with the shipped placeholder NEXTAUTH_SECRET after it is replaced', async () => {
    const token = legacy1xToken();
    store.apiKeys.push({
      id: 'key-default',
      tokenHash: scryptHex(token, 'change_this_to_a_random_secret_in_production'),
      revokedAt: null,
    });

    await expect(authenticateApiKey(apiRequest(token))).resolves.toMatchObject({ id: 'key-default' });
    expect(store.apiKeys[0].tokenHash).toBe(hashTokenV2(token));
  });

  it('keeps 2.0 keys signed with NEXTAUTH_SECRET valid after API_KEY_SECRET is introduced', async () => {
    const token = `ok_live_${randomBytes(32).toString('base64url')}`;
    store.apiKeys.push({ id: 'key-2', tokenHash: hmacV2(token, OLD_NEXTAUTH_SECRET), revokedAt: null });

    await expect(authenticateApiKey(apiRequest(token))).resolves.toMatchObject({ id: 'key-2' });
    expect(store.apiKeys[0].tokenHash).toBe(hmacV2(token, NEW_API_KEY_SECRET));
  });

  it('rejects invalid, unknown-secret and revoked legacy keys', async () => {
    const token = legacy1xToken();
    store.apiKeys.push(
      { id: 'other-secret', tokenHash: scryptHex(token, 'some-other-secret-value-not-configured'), revokedAt: null },
      { id: 'revoked', tokenHash: scryptHex(token, OLD_NEXTAUTH_SECRET), revokedAt: new Date() }
    );

    await expect(authenticateApiKey(apiRequest(token))).resolves.toBeNull();
    await expect(authenticateApiKey(apiRequest(legacy1xToken()))).resolves.toBeNull();
    await expect(authenticateApiKey(apiRequest('ok_live_invalid'))).resolves.toBeNull();
    expect(prisma.apiKey.update).not.toHaveBeenCalled();
  });

  it('authenticates and migrates 1.x status-page API tokens', async () => {
    const token = legacy1xToken();
    store.statusTokens.push({
      id: 'status-1',
      statusPageId: 'page-a',
      tokenHash: scryptHex(token, OLD_NEXTAUTH_SECRET),
      revokedAt: null,
    });

    await expect(statusRequest(token)).resolves.toMatchObject({ allowed: true, tokenId: 'status-1' });
    expect(store.statusTokens[0].tokenHash).toBe(hmacV2(token, NEW_API_KEY_SECRET));

    vi.mocked(prisma.statusPageApiToken.findFirst).mockClear();
    await expect(statusRequest(token)).resolves.toMatchObject({ allowed: true, tokenId: 'status-1' });
    expect(prisma.statusPageApiToken.findFirst).toHaveBeenCalledTimes(1);

    await expect(statusRequest(legacy1xToken())).resolves.toMatchObject({
      allowed: false,
      status: 401,
    });
  });

  it('does not accept a status-page token issued for another page', async () => {
    const token = legacy1xToken();
    store.statusTokens.push({
      id: 'status-b',
      statusPageId: 'page-b',
      tokenHash: scryptHex(token, OLD_NEXTAUTH_SECRET),
      revokedAt: null,
    });

    await expect(statusRequest(token)).resolves.toMatchObject({ allowed: false, status: 401 });
    expect(store.statusTokens[0].tokenHash).toBe(scryptHex(token, OLD_NEXTAUTH_SECRET));
  });
});
