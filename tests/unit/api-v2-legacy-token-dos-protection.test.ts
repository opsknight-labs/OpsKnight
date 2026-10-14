/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
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
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T12:00:10Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
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
  it('authoritatively checks valid token directly and immediately enforces revocation across all replicas with zero cache lag', async () => {
    const validToken = 'ok_live_validkey000111222333444555666777';
    const v2Hash = hashTokenV2(validToken);

    const validRecord = {
      id: 'key_valid_1',
      name: 'Production Ingest Key',
      prefix: validToken.slice(0, 12),
      tokenHash: v2Hash,
      scopes: ['incidents:read', 'events:write'],
      userId: 'usr_owner_1',
      lastUsedAt: new Date(),
      user: {
        id: 'usr_owner_1',
        role: 'ADMIN',
        status: 'ACTIVE',
        department: null,
        jobTitle: null,
        email: 'admin@opsknight.local',
        teamMemberships: [],
      },
    };

    vi.mocked(prisma.apiKey.findFirst).mockResolvedValueOnce(validRecord as any);

    const req1 = new NextRequest('http://localhost:3000/api/v2/incidents', {
      headers: {
        authorization: `Bearer ${validToken}`,
        'x-forwarded-for': '198.51.100.20',
      },
    });

    const ctx1 = await authenticateV2Request(req1);
    expect(ctx1.apiKey.id).toBe('key_valid_1');
    expect(prisma.apiKey.findFirst).toHaveBeenCalledTimes(1);

    // Simulating token revocation on another replica (DB now returns null for active filter)
    vi.mocked(prisma.apiKey.findFirst).mockResolvedValueOnce(null);

    const req2 = new NextRequest('http://localhost:3000/api/v2/incidents', {
      headers: {
        authorization: `Bearer ${validToken}`,
        'x-forwarded-for': '198.51.100.20',
      },
    });

    // Zero cache lag: revoked token is immediately rejected across replicas
    await expect(authenticateV2Request(req2)).rejects.toThrow(
      'The provided API key or service account token is invalid'
    );
    expect(prisma.apiKey.findFirst).toHaveBeenCalledTimes(2);
  });

  it('throttles invalid modern-format API key floods at failed auth limit (60) before querying database', async () => {
    vi.mocked(prisma.apiKey.findFirst).mockResolvedValue(null);

    const clientIp = '198.51.100.77';

    // Send 60 distinct invalid modern-format tokens from same IP
    for (let i = 0; i < 60; i++) {
      const modernToken = `ok_live_randomtoken_${i}_${'z'.repeat(20)}`;
      const req = new NextRequest('http://localhost:3000/api/v2/incidents', {
        headers: {
          authorization: `Bearer ${modernToken}`,
          'x-forwarded-for': clientIp,
        },
      });

      await expect(authenticateV2Request(req)).rejects.toThrow(
        'The provided API key or service account token is invalid'
      );
    }

    expect(prisma.apiKey.findFirst).toHaveBeenCalledTimes(60);

    // 61st invalid request from same IP must be rejected by failed-auth admission limit WITHOUT querying database
    const token61 = `ok_live_randomtoken_61_${'z'.repeat(20)}`;
    const req61 = new NextRequest('http://localhost:3000/api/v2/incidents', {
      headers: {
        authorization: `Bearer ${token61}`,
        'x-forwarded-for': clientIp,
      },
    });

    await expect(authenticateV2Request(req61)).rejects.toMatchObject({
      code: 'RATE_LIMIT_EXCEEDED',
      status: 429,
    });

    // DB was NOT touched for 61st request
    expect(prisma.apiKey.findFirst).toHaveBeenCalledTimes(60);
  });

  it('does not group unidentifiable 0.0.0.0 clients into a shared restrictive rate-limit bucket', async () => {
    vi.mocked(prisma.apiKey.findFirst).mockResolvedValue(null);

    // Direct deployments without reverse proxies where client IP falls back to 0.0.0.0
    // Must never exhaust a shared 60-request quota across unrelated clients
    for (let i = 0; i < 65; i++) {
      const token = `ok_live_directclient_${i}_${'y'.repeat(20)}`;
      const req = new NextRequest('http://localhost:3000/api/v2/incidents', {
        headers: {
          authorization: `Bearer ${token}`,
          // No forwarded headers, untrusted direct fallback
        },
      });

      // Receives 401 invalid token, NEVER 429 rate limit exceeded
      await expect(authenticateV2Request(req)).rejects.toMatchObject({
        code: 'API_KEY_INVALID',
        status: 401,
      });
    }
  });
});
