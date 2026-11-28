/* eslint-disable @typescript-eslint/no-explicit-any -- partial prisma mock */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { checkRateLimit } from '@/lib/rate-limit';
import { enforceV2RateLimit } from '@/lib/api-v2/rate-limit';
import { apiV2Error } from '@/lib/api-v2/response';

const db = prisma as any;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('a rate-limit store failure', () => {
  it('stays fail-closed but is marked unavailable, so callers can tell it from an exceeded quota', async () => {
    db.rateLimit.upsert.mockRejectedValueOnce(new Error('connection terminated'));
    const result = await checkRateLimit('api:test', 10, 60_000);
    expect(result).toMatchObject({ allowed: false, unavailable: true });

    db.rateLimit.upsert.mockResolvedValueOnce({ count: 11 });
    const exceeded = await checkRateLimit('api:test2', 10, 60_000);
    expect(exceeded).toMatchObject({ allowed: false });
    expect(exceeded.unavailable).toBeUndefined();
  });

  it('answers API v2 with 503 and a short Retry-After instead of 429', async () => {
    db.rateLimit.upsert.mockRejectedValueOnce(new Error('connection terminated'));
    const failure = await enforceV2RateLimit('key-unavailable-1', 'READ').catch(error => error);
    const response = apiV2Error(failure);
    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('5');
    expect((await response.json()).code).toBe('DATABASE_UNAVAILABLE');
  });

  it('still answers 429 with the window reset when the quota is really exceeded', async () => {
    db.rateLimit.upsert.mockResolvedValueOnce({ count: 1000 });
    const failure = await enforceV2RateLimit('key-exceeded-1', 'READ').catch(error => error);
    const response = apiV2Error(failure);
    expect(response.status).toBe(429);
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0);
  });
});
