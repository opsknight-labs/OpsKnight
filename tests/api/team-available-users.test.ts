import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { AuthorizationError, CAPABILITIES } from '@/lib/authorization';
import { assertResponderOrAbove } from '@/lib/rbac';
import { GET } from '@/app/api/teams/[id]/available-users/route';

vi.mock('@/lib/prisma', () => ({
  default: {
    team: { findUnique: vi.fn() },
    user: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/rbac', () => ({
  assertResponderOrAbove: vi.fn(),
}));

vi.mock('@/lib/logger', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/logger')>();
  return {
    ...actual,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };
});

describe('team available-user directory search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertResponderOrAbove).mockResolvedValue({ id: 'admin-1' } as never);
    vi.mocked(prisma.team.findUnique).mockResolvedValue({ id: 'team-1' } as never);
  });

  it('searches active non-members in the database with a bounded result set', async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: 'user-1', name: 'Alice', email: 'alice@example.com' },
      { id: 'user-2', name: 'Alicia', email: 'alicia@example.com' },
      { id: 'user-3', name: 'Alina', email: 'alina@example.com' },
    ] as never);
    const request = new NextRequest(
      'http://localhost/api/teams/team-1/available-users?q=ali&limit=2'
    );

    const response = await GET(request, { params: Promise.resolve({ id: 'team-1' }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.users).toHaveLength(2);
    expect(body.hasMore).toBe(true);
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { not: 'DISABLED' },
          teamMemberships: { none: { teamId: 'team-1' } },
        }),
        take: 3,
      })
    );
  });

  it('does not expose the directory to unauthorized users', async () => {
    vi.mocked(assertResponderOrAbove).mockRejectedValue(
      new AuthorizationError(
        'Unauthorized. Responder access or above required.',
        CAPABILITIES.OPERATIONS_MANAGE
      )
    );
    const request = new NextRequest('http://localhost/api/teams/team-1/available-users');

    const response = await GET(request, { params: Promise.resolve({ id: 'team-1' }) });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.code).toBe('AUTHORIZATION_DENIED');
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
});
