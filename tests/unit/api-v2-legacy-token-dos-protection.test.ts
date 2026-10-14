/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { authCache, rateLimitMemoryCache } from '@/lib/api-v2/cache';
import { authenticateV2Request } from '@/lib/api-v2/auth';
import { hashTokenV2 } from '@/lib/api-keys';

describe('API v2 Pre-Authentication Legacy Token DoS Protection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authCache.clear();
    rateLimitMemoryCache.clear();
  });

  it('rejects an invalid token and serves subsequent identical requests from negative cache', async () => {
    vi.mocked(prisma.apiKey.findFirst).mockResolvedValue(null);

    const req1 = new NextRequest('http://localhost:3000/api/v2/incidents', {
      headers: {
        authorization: 'Bearer ok_live_invalidtoken12345678901234567890',
        'x-forwarded-for': '198.51.100.1',
      },
    });

    await expect(authenticateV2Request(req1)).rejects.toThrow(
      'The provided API key or service account token is invalid'
    );
    expect(prisma.apiKey.findFirst).toHaveBeenCalledTimes(1);

    // Second request with exact same invalid token should hit negative cache and skip prisma
    const req2 = new NextRequest('http://localhost:3000/api/v2/incidents', {
      headers: {
        authorization: 'Bearer ok_live_invalidtoken12345678901234567890',
        'x-forwarded-for': '198.51.100.1',
      },
    });

    await expect(authenticateV2Request(req2)).rejects.toThrow(
      'The provided API key or service account token is invalid'
    );
    // findFirst count remains 1 because negative cache intercepted
    expect(prisma.apiKey.findFirst).toHaveBeenCalledTimes(1);
  });

  it('throttles invalid 1.x-shaped legacy tokens via IP admission limit before expensive scrypt calculations', async () => {
    vi.mocked(prisma.apiKey.findFirst).mockResolvedValue(null);

    const clientIp = '203.0.113.42';

    // Send 10 invalid 1.x-shaped tokens (ok_ + 43 characters = 46 chars total)
    for (let i = 0; i < 10; i++) {
      const randomSuffix = `testtoken${i}`.padEnd(43, 'a');
      const req = new NextRequest('http://localhost:3000/api/v2/incidents', {
        headers: {
          authorization: `Bearer ok_${randomSuffix}`,
          'x-forwarded-for': clientIp,
        },
      });

      await expect(authenticateV2Request(req)).rejects.toThrow(
        'The provided API key or service account token is invalid'
      );
    }

    // 11th request from the same IP with a 1.x-shaped token should be rejected with RATE_LIMIT_EXCEEDED
    const randomSuffix11 = 'testtoken11'.padEnd(43, 'b');
    const req11 = new NextRequest('http://localhost:3000/api/v2/incidents', {
      headers: {
        authorization: `Bearer ok_${randomSuffix11}`,
        'x-forwarded-for': clientIp,
      },
    });

    await expect(authenticateV2Request(req11)).rejects.toMatchObject({
      code: 'RATE_LIMIT_EXCEEDED',
      status: 429,
    });

    // Requests from a DIFFERENT IP are not blocked by the first IP's admission exhaustion
    const differentIpReq = new NextRequest('http://localhost:3000/api/v2/incidents', {
      headers: {
        authorization: `Bearer ok_${randomSuffix11}`,
        'x-forwarded-for': '198.51.100.99',
      },
    });

    // Different IP still receives 401 invalid rather than 429 rate limit
    await expect(authenticateV2Request(differentIpReq)).rejects.toThrow(
      'The provided API key or service account token is invalid'
    );
  });

  it('allows valid legacy tokens through and upgrades them to v2 hash', async () => {
    const legacyToken = `ok_${'x'.repeat(43)}`;
    const v2Hash = hashTokenV2(legacyToken);

    // Initial lookup with v2Hash returns null, secondary lookup with legacy candidates succeeds
    vi.mocked(prisma.apiKey.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'key_migrated_1',
        name: 'Legacy 1.x Key',
        prefix: legacyToken.slice(0, 12),
        tokenHash: 'legacy_hash_val',
        scopes: ['incidents:read'],
        userId: 'usr_owner_1',
        user: {
          id: 'usr_owner_1',
          role: 'ADMIN',
          status: 'ACTIVE',
          department: null,
          jobTitle: null,
          email: 'admin@opsknight.local',
          teamMemberships: [],
        },
      } as any);

    vi.mocked(prisma.apiKey.update).mockResolvedValue({} as any);

    const req = new NextRequest('http://localhost:3000/api/v2/incidents', {
      headers: {
        authorization: `Bearer ${legacyToken}`,
        'x-forwarded-for': '198.51.100.5',
      },
    });

    const context = await authenticateV2Request(req);
    expect(context.apiKey.id).toBe('key_migrated_1');
    expect(context.actor.id).toBe('usr_owner_1');

    // Verify transparent lazy upgrade to v2 hash occurred
    expect(prisma.apiKey.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'key_migrated_1' },
        data: expect.objectContaining({ tokenHash: v2Hash }),
      })
    );
  });
});
