import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { queryRaw, schedulerFindUnique } = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  schedulerFindUnique: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    $queryRaw: queryRaw,
    cronSchedulerState: { findUnique: schedulerFindUnique },
  },
}));

import { GET } from '@/app/api/health/route';

describe('public readiness response', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPSKNIGHT_PROCESS_ROLE = 'web';
    queryRaw.mockResolvedValue([{ '?column?': 1 }]);
  });

  it('does not expose the persisted scheduler error', async () => {
    schedulerFindUnique.mockResolvedValue({
      lastRunAt: new Date(),
      lastError: 'postgresql://secret-user:secret-password@internal-db/provider-token',
    });

    const response = await GET(new NextRequest('http://localhost/api/health?mode=readiness'));
    const body = await response.json();

    expect(body.checks.scheduler).toEqual({ status: 'disabled', expected: false });
    expect(JSON.stringify(body)).not.toContain('secret-password');
    expect(response.status).toBe(200);
  });

  it('does not expose database connection errors', async () => {
    queryRaw.mockRejectedValue(
      new Error('connect failed for postgresql://secret-user:secret-password@internal-db')
    );
    schedulerFindUnique.mockResolvedValue({ lastRunAt: new Date(), lastError: null });

    const response = await GET(new NextRequest('http://localhost/api/health?mode=readiness'));
    const body = await response.json();

    expect(body.checks.database.error).toBe('Database connection failed');
    expect(JSON.stringify(body)).not.toContain('secret-password');
    expect(response.status).toBe(503);
  });
});
