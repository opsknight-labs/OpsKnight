// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getUserPermissions: vi.fn(),
  discoverSubjectData: vi.fn(),
}));

vi.mock('@/lib/rbac', () => ({ getUserPermissions: mocks.getUserPermissions }));
vi.mock('@/lib/privacy/discovery', async importOriginal => {
  const original = await importOriginal<typeof import('@/lib/privacy/discovery')>();
  return { ...original, discoverSubjectData: mocks.discoverSubjectData };
});

import { GET } from '@/app/api/compliance/privacy-discovery/route';

const userId = 'clw8q8z48000008l6c5f14abc';

describe('privacy discovery API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requires authentication and administrator capability', async () => {
    mocks.getUserPermissions.mockResolvedValueOnce({ authenticated: false, capabilities: [] });
    expect(
      (
        await GET(
          new NextRequest(`http://localhost/api/compliance/privacy-discovery?userId=${userId}`)
        )
      ).status
    ).toBe(401);

    mocks.getUserPermissions.mockResolvedValueOnce({ authenticated: true, capabilities: [] });
    expect(
      (
        await GET(
          new NextRequest(`http://localhost/api/compliance/privacy-discovery?userId=${userId}`)
        )
      ).status
    ).toBe(403);
    expect(mocks.discoverSubjectData).not.toHaveBeenCalled();
  });

  it('rejects malformed input', async () => {
    mocks.getUserPermissions.mockResolvedValueOnce({
      id: 'clw8q8z48000008l6c5f14def',
      authenticated: true,
      capabilities: ['admin.manage'],
    });
    const response = await GET(
      new NextRequest('http://localhost/api/compliance/privacy-discovery?userId=../bad')
    );
    expect(response.status).toBe(400);
    expect(mocks.discoverSubjectData).not.toHaveBeenCalled();
  });

  it('returns count-only results without shared caching', async () => {
    mocks.getUserPermissions.mockResolvedValueOnce({
      id: 'clw8q8z48000008l6c5f14def',
      authenticated: true,
      capabilities: ['admin.manage'],
    });
    mocks.discoverSubjectData.mockResolvedValueOnce({
      subjectUserId: userId,
      counts: { user: 1 },
      limitations: [],
    });
    const response = await GET(
      new NextRequest(`http://localhost/api/compliance/privacy-discovery?userId=${userId}`)
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = await response.json();
    expect(body).toMatchObject({ success: true, dataState: 'available' });
    expect(body.data).toEqual({
      subjectUserId: userId,
      counts: { user: 1 },
      limitations: [],
    });
    expect(mocks.discoverSubjectData).toHaveBeenCalledWith({
      userId,
      actorUserId: 'clw8q8z48000008l6c5f14def',
    });
  });
});
