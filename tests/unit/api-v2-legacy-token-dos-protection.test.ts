/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { authCache, rateLimitMemoryCache } from '@/lib/api-v2/cache';
import { authenticateV2Request } from '@/lib/api-v2/auth';
import { hashTokenV2 } from '@/lib/api-keys';

const request = (token: string, ip?: string) =>
  new NextRequest('http://localhost:3000/api/v2/incidents', {
    headers: {
      authorization: `Bearer ${token}`,
      ...(ip ? { 'x-forwarded-for': ip } : {}),
    },
  });

describe('API v2 Pre-Authentication Legacy Token DoS Protection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.rateLimit.upsert).mockReset();
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

  it('keeps verifying tokens from an IP over its failed-auth budget, so a valid client behind the same NAT still works', async () => {
    const clientIp = '198.51.100.77';
    vi.mocked(prisma.apiKey.findFirst).mockResolvedValue(null);

    for (let i = 0; i < 60; i++) {
      await expect(
        authenticateV2Request(
          new NextRequest('http://localhost:3000/api/v2/incidents', {
            headers: {
              authorization: `Bearer ok_live_randomtoken_${i}_${'z'.repeat(20)}`,
              'x-forwarded-for': clientIp,
            },
          })
        )
      ).rejects.toThrow('The provided API key or service account token is invalid');
    }
    expect(prisma.apiKey.findFirst).toHaveBeenCalledTimes(60);

    // The budget is spent, yet a valid credential from the same address authenticates.
    const validToken = `ok_live_${'v'.repeat(30)}`;
    vi.mocked(prisma.apiKey.findFirst).mockResolvedValueOnce({
      id: 'key_nat_1',
      name: 'CI behind NAT',
      prefix: validToken.slice(0, 12),
      tokenHash: hashTokenV2(validToken),
      scopes: ['incidents:read'],
      userId: 'usr_nat',
      lastUsedAt: new Date(),
      user: {
        id: 'usr_nat',
        role: 'ADMIN',
        status: 'ACTIVE',
        department: null,
        jobTitle: null,
        email: 'ci@opsknight.local',
        teamMemberships: [],
      },
    } as any);
    const context = await authenticateV2Request(
      new NextRequest('http://localhost:3000/api/v2/incidents', {
        headers: { authorization: `Bearer ${validToken}`, 'x-forwarded-for': clientIp },
      })
    );
    expect(context.apiKey.id).toBe('key_nat_1');
  });

  it('bounds concurrent verification from an over-budget IP and reports Retry-After', async () => {
    const clientIp = '198.51.100.78';
    const { OVER_BUDGET_IP_CONCURRENCY: max } = await import('@/lib/api-v2/rate-limit');
    vi.mocked(prisma.apiKey.findFirst).mockResolvedValue(null);
    for (let i = 0; i < 60; i++) {
      await authenticateV2Request(request(`ok_live_warm_${i}_${'w'.repeat(24)}`, clientIp)).catch(
        () => undefined
      );
    }

    const gates: Array<() => void> = [];
    vi.mocked(prisma.apiKey.findFirst).mockImplementation(
      () => new Promise(resolve => gates.push(() => resolve(null))) as any
    );
    const inFlight = Array.from({ length: max }, (_, i) =>
      authenticateV2Request(request(`ok_live_busy_${i}_${'b'.repeat(24)}`, clientIp)).catch(e => e)
    );
    await vi.waitFor(() => expect(gates.length).toBe(max));

    const shed = await authenticateV2Request(
      request(`ok_live_extra_${'e'.repeat(24)}`, clientIp)
    ).catch(e => e);
    expect(shed).toMatchObject({ code: 'RATE_LIMIT_EXCEEDED', status: 429 });
    expect(shed.details.retryAfter).toBeGreaterThanOrEqual(1);

    // Another address is unaffected while this one is saturated.
    const otherIp = authenticateV2Request(
      request(`ok_live_other_${'o'.repeat(24)}`, '198.51.100.79')
    ).catch(e => e);
    await vi.waitFor(() => expect(gates.length).toBe(max + 1));
    gates.forEach(release => release());
    expect((await otherIp).code).toBe('API_KEY_INVALID');
    await Promise.all(inFlight);
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

  describe('distributed and unidentified-client protections', () => {
    it('learns the shared PostgreSQL failed-auth count, so failures spread over replicas still put the IP over budget', async () => {
      vi.mocked(prisma.apiKey.findFirst).mockResolvedValue(null);
      // Other replicas already recorded 59 failures for this IP in the shared counter.
      vi.mocked(prisma.rateLimit.upsert).mockResolvedValue({ count: 60 } as any);

      await expect(
        authenticateV2Request(request(`ok_live_${'a'.repeat(30)}`, '198.51.100.150'))
      ).rejects.toMatchObject({ code: 'API_KEY_INVALID' });

      // Over budget now: the IP is concurrency-bounded, and stops writing the shared counter.
      const { isFailedAuthAdmissionBlocked } = await import('@/lib/api-v2/rate-limit');
      expect(await isFailedAuthAdmissionBlocked('198.51.100.150')).toBe(true);
      const upserts = vi.mocked(prisma.rateLimit.upsert).mock.calls.length;
      await authenticateV2Request(request(`ok_live_${'b'.repeat(30)}`, '198.51.100.150')).catch(
        () => undefined
      );
      expect(vi.mocked(prisma.rateLimit.upsert).mock.calls.length).toBe(upserts);
    });

    it('rejects malformed tokens before any database lookup', async () => {
      for (const token of [
        'x',
        'ok_short',
        `ok_live_${'a'.repeat(300)}`,
        'ok_bad chars here!!!!!!!',
      ]) {
        await expect(authenticateV2Request(request(token, '198.51.100.151'))).rejects.toMatchObject(
          {
            code: 'API_KEY_INVALID',
          }
        );
      }
      expect(prisma.apiKey.findFirst).not.toHaveBeenCalled();
    });

    it('bounds concurrent verification for unidentified clients without a quota lockout', async () => {
      const gates: Array<() => void> = [];
      vi.mocked(prisma.apiKey.findFirst).mockImplementation(
        () =>
          new Promise(resolve => {
            gates.push(() => resolve(null));
          }) as any
      );
      const { UNIDENTIFIED_VERIFICATION_CONCURRENCY: max } =
        await import('@/lib/api-v2/rate-limit');

      const inFlight = Array.from({ length: max }, (_, i) =>
        authenticateV2Request(request(`ok_live_flood_${i}_${'f'.repeat(24)}`)).catch(error => error)
      );
      await vi.waitFor(() => expect(gates.length).toBe(max));

      const shed = await authenticateV2Request(request(`ok_live_extra_${'e'.repeat(24)}`)).catch(
        error => error
      );
      expect(shed).toMatchObject({ code: 'RATE_LIMIT_EXCEEDED', status: 429 });
      expect(shed.details.retryAfter).toBe(1);

      gates.forEach(release => release());
      const settled = await Promise.all(inFlight);
      expect(settled.every(e => e.code === 'API_KEY_INVALID')).toBe(true);

      // Slots are released: the bucket is usable again and was never quota-locked.
      vi.mocked(prisma.apiKey.findFirst).mockResolvedValue(null);
      await expect(
        authenticateV2Request(request(`ok_live_after_${'a'.repeat(24)}`))
      ).rejects.toMatchObject({ code: 'API_KEY_INVALID' });
    });

    it('queues a brief burst for an unidentified client instead of rejecting it', async () => {
      const gates: Array<() => void> = [];
      vi.mocked(prisma.apiKey.findFirst).mockImplementation(
        () => new Promise(resolve => gates.push(() => resolve(null))) as any
      );
      const { UNIDENTIFIED_VERIFICATION_CONCURRENCY: max } =
        await import('@/lib/api-v2/rate-limit');

      const first = Array.from({ length: max }, (_, i) =>
        authenticateV2Request(request(`ok_live_burst_${i}_${'b'.repeat(24)}`)).catch(error => error)
      );
      await vi.waitFor(() => expect(gates.length).toBe(max));

      // One more caller arrives while every slot is busy; a slot frees up shortly after.
      const queued = authenticateV2Request(request(`ok_live_queued_${'q'.repeat(24)}`)).catch(
        error => error
      );
      setTimeout(() => gates[0]!(), 20);
      await vi.waitFor(() => expect(gates.length).toBe(max + 1));
      gates.forEach(release => release());

      const result = await queued;
      expect(result).toMatchObject({ code: 'API_KEY_INVALID' }); // verified (and invalid), not shed
      await Promise.all(first);
    });

    it('applies a stricter shared legacy-scrypt budget to unidentified clients', async () => {
      vi.mocked(prisma.apiKey.findFirst).mockResolvedValue(null);
      const { LEGACY_UNIDENTIFIED_LIMIT: limit } = await import('@/lib/api-v2/rate-limit');

      for (let i = 0; i < limit; i++) {
        await expect(
          authenticateV2Request(request(`ok_${`u${i}`.padEnd(43, 'a')}`))
        ).rejects.toMatchObject({ code: 'API_KEY_INVALID' });
      }
      const shed = await authenticateV2Request(request(`ok_${'z'.repeat(43)}`)).catch(e => e);
      expect(shed).toMatchObject({ code: 'RATE_LIMIT_EXCEEDED', status: 429 });
      expect(shed.details.retryAfter).toBeGreaterThanOrEqual(1);

      // Modern-format tokens from the same bucket are unaffected.
      await expect(
        authenticateV2Request(request(`ok_live_modern_${'m'.repeat(24)}`))
      ).rejects.toMatchObject({ code: 'API_KEY_INVALID' });
    });
  });
});

describe('priority admission for recently verified credentials', () => {
  const ip = '198.51.100.200';
  const validToken = `ok_live_${'p'.repeat(30)}`;
  const record = () =>
    ({
      id: 'key_prio',
      name: 'prio',
      prefix: validToken.slice(0, 12),
      tokenHash: hashTokenV2(validToken),
      scopes: ['incidents:read'],
      userId: 'usr_prio',
      lastUsedAt: new Date(),
      user: {
        id: 'usr_prio',
        role: 'ADMIN',
        status: 'ACTIVE',
        department: null,
        jobTitle: null,
        email: 'prio@opsknight.local',
        teamMemberships: [],
      },
    }) as any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.rateLimit.upsert).mockReset();
    authCache.clear();
    rateLimitMemoryCache.clear();
  });

  async function flushOverBudget() {
    vi.mocked(prisma.apiKey.findFirst).mockResolvedValue(null);
    for (let i = 0; i < 61; i++) {
      await authenticateV2Request(request(`ok_live_burn_${i}_${'b'.repeat(24)}`, ip)).catch(
        () => undefined
      );
    }
  }

  it('keeps a verified credential working while the address floods with the allowance saturated', async () => {
    const { verifiedCredentialHints } = await import('@/lib/api-v2/cache');
    verifiedCredentialHints.clear();
    vi.mocked(prisma.apiKey.findFirst).mockResolvedValueOnce(record());
    await authenticateV2Request(request(validToken, ip)); // becomes a known-good hint

    await flushOverBudget();
    const { OVER_BUDGET_IP_CONCURRENCY: max } = await import('@/lib/api-v2/rate-limit');

    // Saturate the over-budget allowance with in-flight unknown-token lookups.
    const gates: Array<() => void> = [];
    vi.mocked(prisma.apiKey.findFirst).mockImplementation(
      () => new Promise(resolve => gates.push(() => resolve(null))) as any
    );
    const flood = Array.from({ length: max }, (_, i) =>
      authenticateV2Request(request(`ok_live_flood_${i}_${'f'.repeat(24)}`, ip)).catch(e => e)
    );
    await vi.waitFor(() => expect(gates.length).toBe(max));
    const shed = await authenticateV2Request(
      request(`ok_live_unknown_${'u'.repeat(24)}`, ip)
    ).catch(e => e);
    expect(shed).toMatchObject({ code: 'RATE_LIMIT_EXCEEDED' });

    // The hinted credential is not queued behind the flood.
    vi.mocked(prisma.apiKey.findFirst).mockImplementation((async () => record()) as any);
    const context = await authenticateV2Request(request(validToken, ip));
    expect(context.apiKey.id).toBe('key_prio');

    gates.forEach(release => release());
    await Promise.all(flood);
  });

  it('still consults the database for a hinted credential, so revocation is immediate', async () => {
    const { verifiedCredentialHints } = await import('@/lib/api-v2/cache');
    verifiedCredentialHints.clear();
    vi.mocked(prisma.apiKey.findFirst).mockResolvedValueOnce(record());
    await authenticateV2Request(request(validToken, ip));
    expect(verifiedCredentialHints.get(hashTokenV2(validToken))).toBe(true);

    vi.mocked(prisma.apiKey.findFirst).mockResolvedValue(null); // revoked
    await expect(authenticateV2Request(request(validToken, ip))).rejects.toMatchObject({
      code: 'API_KEY_INVALID',
    });
    // The hint is dropped, so the revoked token gets no priority afterwards.
    expect(verifiedCredentialHints.get(hashTokenV2(validToken))).toBeUndefined();
  });

  it('never grants the priority lane to an unknown token', async () => {
    const { verifiedCredentialHints } = await import('@/lib/api-v2/cache');
    verifiedCredentialHints.clear();
    vi.mocked(prisma.apiKey.findFirst).mockResolvedValue(null);
    await authenticateV2Request(request(`ok_live_nobody_${'n'.repeat(24)}`, ip)).catch(
      () => undefined
    );
    expect(verifiedCredentialHints.size).toBe(0);
  });
});
