import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/search/route';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn().mockResolvedValue([]),
  userFindUnique: vi.fn(),
}));

vi.mock('next-auth', () => ({
  getServerSession: vi.fn().mockResolvedValue({ user: { email: 'user@example.com' } }),
}));

vi.mock('@/lib/auth', () => ({ getAuthOptions: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({
  default: {
    incident: { findMany: mocks.findMany },
    service: { findMany: mocks.findMany },
    team: { findMany: mocks.findMany },
    user: { findUnique: mocks.userFindUnique, findMany: mocks.findMany },
    escalationPolicy: { findMany: mocks.findMany },
    postmortem: { findMany: mocks.findMany },
  },
}));

describe('global search RBAC', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findMany.mockResolvedValue([]);
  });

  it('adds team and assignee scope for regular users', async () => {
    mocks.userFindUnique.mockResolvedValue({
      id: 'user-1',
      role: 'VIEWER',
      status: 'ACTIVE',
      teamMemberships: [{ teamId: 'team-1' }],
    });

    const response = await GET(new NextRequest('http://localhost/api/search?q=database'));

    expect(response.status).toBe(200);
    const incidentQuery = mocks.findMany.mock.calls[0][0];
    expect(incidentQuery.where.AND[0]).toEqual({
      OR: [{ assigneeId: 'user-1' }, { service: { teamId: { in: ['team-1'] } } }],
    });
    const serviceQuery = mocks.findMany.mock.calls[1][0];
    expect(serviceQuery.where.AND[0]).toEqual({ teamId: { in: ['team-1'] } });
  });

  it('preserves global search for responders', async () => {
    mocks.userFindUnique.mockResolvedValue({
      id: 'responder-1',
      role: 'RESPONDER',
      status: 'ACTIVE',
      teamMemberships: [],
    });

    const response = await GET(new NextRequest('http://localhost/api/search?q=database'));

    expect(response.status).toBe(200);
    expect(mocks.findMany.mock.calls[0][0].where.AND[0]).toEqual({});
  });
});
