import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  default: {
    $transaction: vi.fn(),
    user: {
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('@/lib/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/users/admin-invariants', () => ({
  updateUserSecurityState: vi.fn(),
}));

import prisma from '@/lib/prisma';
import { updateUserSecurityState } from '@/lib/users/admin-invariants';
import { GET as listUsers } from '@/app/api/scim/v2/Users/route';
import { DELETE as deleteUser, PUT as replaceUser } from '@/app/api/scim/v2/Users/[id]/route';

const token = 'scim-test-token-that-is-longer-than-thirty-two-characters';
const originalToken = process.env.SCIM_BEARER_TOKEN;
const context = { params: Promise.resolve({ id: 'user-1' }) };

function request(
  url: string,
  init: { method?: string; body?: BodyInit; headers?: HeadersInit } = {}
) {
  return new NextRequest(url, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...init.headers },
  });
}

const scimUser = {
  id: 'user-1',
  scimExternalId: 'directory-1',
  email: 'alice@example.com',
  name: 'Alice',
  role: 'USER',
  status: 'ACTIVE',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('SCIM Users HTTP lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SCIM_BEARER_TOKEN = token;
  });

  afterAll(() => {
    if (originalToken === undefined) delete process.env.SCIM_BEARER_TOKEN;
    else process.env.SCIM_BEARER_TOKEN = originalToken;
  });

  it('never exposes a non-SCIM account through userName filtering', async () => {
    vi.mocked(prisma.$transaction).mockResolvedValue([[], 0] as never);

    const response = await listUsers(
      request(
        'https://ops.example.com/api/scim/v2/Users?filter=userName%20eq%20%22alice%40example.com%22'
      )
    );

    expect(response.status).toBe(200);
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [{ scimExternalId: { not: null } }, { email: 'alice@example.com' }],
        },
      })
    );
  });

  it('replaces a SCIM resource and revokes its existing sessions', async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue(scimUser as never);
    vi.mocked(updateUserSecurityState).mockResolvedValue({
      ...scimUser,
      email: 'renamed@example.com',
      name: 'Renamed',
    } as never);

    const response = await replaceUser(
      request('https://ops.example.com/api/scim/v2/Users/user-1', {
        method: 'PUT',
        body: JSON.stringify({
          externalId: 'directory-1',
          userName: 'renamed@example.com',
          displayName: 'Renamed',
          active: true,
        }),
      }),
      context
    );

    expect(response.status).toBe(200);
    expect(updateUserSecurityState).toHaveBeenCalledWith(
      'user-1',
      { status: 'ACTIVE' },
      expect.objectContaining({
        email: 'renamed@example.com',
        roleSource: 'SCIM',
        tokenVersion: { increment: 1 },
      })
    );
  });

  it('deprovisions DELETE requests and immediately revokes sessions', async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      id: 'user-1',
      scimExternalId: 'directory-1',
    } as never);
    vi.mocked(updateUserSecurityState).mockResolvedValue({} as never);

    const response = await deleteUser(
      request('https://ops.example.com/api/scim/v2/Users/user-1', { method: 'DELETE' }),
      context
    );

    expect(response.status).toBe(204);
    expect(updateUserSecurityState).toHaveBeenCalledWith(
      'user-1',
      { status: 'DISABLED' },
      { roleSource: 'SCIM', tokenVersion: { increment: 1 } }
    );
  });
});
