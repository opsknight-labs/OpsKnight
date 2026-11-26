import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const m = vi.hoisted(() => ({
  assertCapability: vi.fn(),
  checkRateLimit: vi.fn(),
  getAnalyticsSection: vi.fn(),
  createAnalyticsContext: vi.fn(),
}));

vi.mock('@/lib/rbac', () => ({
  assertCapability: m.assertCapability,
  getCurrentAuthorizationActor: vi.fn(),
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: m.checkRateLimit }));
vi.mock('@/lib/prisma', () => ({ default: { $queryRaw: vi.fn() } }));
vi.mock('@/lib/analytics', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/analytics')>()),
  createAnalyticsContext: m.createAnalyticsContext,
  getAnalyticsSection: m.getAnalyticsSection,
}));

import { GET } from '@/app/api/insights/export/route';
import { parseAnalyticsParams } from '@/lib/analytics';

describe('GET /api/insights/export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.assertCapability.mockResolvedValue({ id: 'user-1', role: 'AUDITOR' });
  });

  it('answers 429 without computing anything once the caller is over the limit', async () => {
    m.checkRateLimit.mockResolvedValue({ allowed: false });

    const response = await GET(new NextRequest('http://localhost/api/insights/export'));

    expect(response.status).toBe(429);
    expect(m.checkRateLimit).toHaveBeenCalledWith('analytics:export:user-1', 10, 60_000);
    expect(m.createAnalyticsContext).not.toHaveBeenCalled();
    expect(m.getAnalyticsSection).not.toHaveBeenCalled();
  });

  it('treats a nonsense window as the default range instead of a NaN or huge window', () => {
    const fallback = parseAnalyticsParams(new URLSearchParams()).range;

    expect(parseAnalyticsParams(new URLSearchParams('window=abc')).range).toBe(fallback);
    expect(parseAnalyticsParams(new URLSearchParams('window=0')).range).toBe(fallback);
    expect(parseAnalyticsParams(new URLSearchParams('window=NaN')).range).toBe(fallback);
    // An oversized day count is clamped to the largest preset rather than computed as asked.
    expect(parseAnalyticsParams(new URLSearchParams('window=36500')).range).toBe('1095d');
  });
});
