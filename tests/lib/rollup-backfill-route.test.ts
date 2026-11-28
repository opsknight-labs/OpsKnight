import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ backfillRollups: vi.fn() }));

vi.mock('@/lib/rbac', () => ({ assertAdmin: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/metric-rollup', () => ({ backfillRollups: mocks.backfillRollups }));
vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { POST } from '@/app/api/admin/rollups/backfill/route';

const post = () =>
  new NextRequest('https://ops.example.test/api/admin/rollups/backfill', {
    method: 'POST',
    body: JSON.stringify({ fromDate: '2026-01-01', toDate: '2026-01-02' }),
  });

describe('POST /api/admin/rollups/backfill', () => {
  beforeEach(() => vi.clearAllMocks());

  it('answers completed when every service rollup was generated', async () => {
    mocks.backfillRollups.mockResolvedValue({ days: 2, failures: 0, failedDays: [] });

    const response = await POST(post());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'completed' });
  });

  it('answers partial with the failed days when some service rollups failed', async () => {
    mocks.backfillRollups.mockResolvedValue({
      days: 2,
      failures: 3,
      failedDays: ['2026-01-01', '2026-01-02'],
    });

    const response = await POST(post());
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(500);
    expect(body).toMatchObject({
      status: 'partial',
      failedServiceRollups: 3,
      failedDays: ['2026-01-01', '2026-01-02'],
    });
    expect(String(body.error)).toContain('3 service rollup(s) failed');
  });
});
