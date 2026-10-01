import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getCurrentAuthorizationActor: vi.fn(),
  dashboardUserReadWhere: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock('@/lib/rbac', () => ({
  getCurrentAuthorizationActor: mocks.getCurrentAuthorizationActor,
}));

vi.mock('@/lib/authorization-filters', () => ({
  dashboardUserReadWhere: mocks.dashboardUserReadWhere,
}));

vi.mock('@/lib/prisma', () => ({
  default: { user: { findMany: mocks.findMany } },
}));

import { GET } from '@/app/api/action-items/owners/route';

describe('action-items owners search route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentAuthorizationActor.mockResolvedValue({ id: 'actor-1', role: 'ADMIN' });
    mocks.dashboardUserReadWhere.mockReturnValue({});
  });

  it('returns active users matching query with bounded take', async () => {
    mocks.findMany.mockResolvedValue([
      { id: 'user-1', name: 'Alice Smith', email: 'alice@example.com' },
    ]);

    const req = new NextRequest('http://localhost/api/action-items/owners?q=Alice&limit=10');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.users).toHaveLength(1);
    expect(body.data.users[0].name).toBe('Alice Smith');
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'ACTIVE',
        }),
        take: 11,
      })
    );
  });

  it('returns first page of users when search query is empty', async () => {
    mocks.findMany.mockResolvedValue([
      { id: 'user-1', name: 'Alice Smith', email: 'alice@example.com' },
      { id: 'user-2', name: 'Bob Jones', email: 'bob@example.com' },
    ]);

    const req = new NextRequest('http://localhost/api/action-items/owners');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.users).toHaveLength(2);
    expect(body.data.hasMore).toBe(false);
  });
});
