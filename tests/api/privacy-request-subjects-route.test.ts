import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertCapability: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock('@/lib/rbac', () => ({ assertCapability: mocks.assertCapability }));
vi.mock('@/lib/prisma', () => ({
  default: { user: { findMany: mocks.findMany } },
}));

import { NextRequest } from 'next/server';
import { GET } from '@/app/api/compliance/privacy-requests/subjects/route';
import { CAPABILITIES } from '@/lib/authorization';

describe('privacy request subject search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertCapability.mockResolvedValue({ id: 'cactor0000001' });
  });

  it('searches all active users by name or email with a bounded result set', async () => {
    mocks.findMany.mockResolvedValue([
      { id: 'csubject00001', name: 'Ada Lovelace', email: 'ada@example.com' },
    ]);

    const response = await GET(
      new NextRequest('https://example.com/api/compliance/privacy-requests/subjects?search=Ada')
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.assertCapability).toHaveBeenCalledWith(CAPABILITIES.PRIVACY_REQUESTS_MANAGE);
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: 'ACTIVE',
          OR: [
            { name: { contains: 'Ada', mode: 'insensitive' } },
            { email: { contains: 'Ada', mode: 'insensitive' } },
          ],
        },
        take: 50,
      })
    );
    expect(body.data.users).toHaveLength(1);
  });

  it('rejects underspecified searches before querying users', async () => {
    const response = await GET(
      new NextRequest('https://example.com/api/compliance/privacy-requests/subjects?search=a')
    );

    expect(response.status).toBe(400);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});
