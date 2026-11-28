import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const m = vi.hoisted(() => {
  const tx = {
    scimGroup: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    scimIdentity: { findMany: vi.fn() },
    scimGroupMembership: { deleteMany: vi.fn(), createMany: vi.fn() },
  };
  return { tx, event: vi.fn() };
});

vi.mock('@/lib/prisma', () => ({
  default: { $transaction: async (operation: (tx: typeof m.tx) => unknown) => operation(m.tx) },
}));
vi.mock('@/lib/db-utils', () => ({
  runSerializableTransaction: async (operation: (tx: typeof m.tx) => unknown) => operation(m.tx),
}));
vi.mock('@/lib/session-security-projection', () => ({
  invalidateSessionSecurityProjections: vi.fn(),
}));
vi.mock('@/lib/scim/security/credentials', () => ({
  authorize: async () => ({ connectorId: 'conn-1', credentialId: 'cred-1' }),
  recheck: vi.fn(),
}));
vi.mock('@/lib/scim/protocol/origin', () => ({
  resolveScimPublicOrigin: async () => 'https://ops.example.test',
}));
vi.mock('@/lib/scim/lifecycle/roles', () => ({ reconcileScimRoles: async () => [] }));
vi.mock('@/lib/scim/lifecycle/events', () => ({ event: m.event }));
vi.mock('@/lib/scim/lifecycle/membership', () => ({
  reconcileTeam: async () => ({ changedUserIds: [] }),
}));

import { GROUP_MEMBER_RESPONSE_BUDGET, groups } from '@/lib/scim/lifecycle/groups';

const at = (url: string, init?: ConstructorParameters<typeof NextRequest>[1]) =>
  new NextRequest(`https://ops.example.test/api/scim/v2/Groups${url}`, init);
const date = new Date('2026-01-01T00:00:00Z');
const stored = (memberships: Array<{ userId: string }>) => ({
  id: 'g-1',
  name: 'Ops',
  scimExternalId: null,
  memberships: memberships.map(member => ({
    ...member,
    user: { id: member.userId, name: member.userId, email: `${member.userId}@example.test` },
  })),
  createdAt: date,
  updatedAt: date,
});

describe('SCIM group list paging', () => {
  const candidate = (id: string, members: number) => ({ id, _count: { memberships: members } });

  beforeEach(() => {
    vi.clearAllMocks();
    m.tx.scimGroup.count.mockResolvedValue(3);
    m.tx.scimGroup.findMany.mockImplementation(
      async (args: { where: { id?: { in: string[] } } }) =>
        args.where.id
          ? args.where.id.in.map(id => ({ ...stored([]), id }))
          : [candidate('g-a', 6000), candidate('g-b', 6000), candidate('g-c', 10)]
    );
  });

  it('cuts a page the client did not size and reports the shorter itemsPerPage', async () => {
    const response = await groups(at(''));
    const body = (await response.json()) as { itemsPerPage: number; Resources: unknown[] };

    expect(response.status).toBe(200);
    expect(body.itemsPerPage).toBe(1);
    expect(body.Resources).toHaveLength(1);
  });

  it('refuses to cut a page the client sized with count, so stepping by count skips nothing', async () => {
    const response = await groups(at('?count=3')).catch((error: unknown) => error);

    expect(response).toMatchObject({ status: 413, scimType: 'tooLarge' });
    expect((response as Error).message).toContain(String(GROUP_MEMBER_RESPONSE_BUDGET));
  });

  it('returns the full requested page when it fits the budget', async () => {
    m.tx.scimGroup.findMany.mockImplementation(
      async (args: { where: { id?: { in: string[] } } }) =>
        args.where.id
          ? args.where.id.in.map(id => ({ ...stored([]), id }))
          : [candidate('g-a', 10), candidate('g-b', 10), candidate('g-c', 10)]
    );
    const response = await groups(at('?count=3'));
    const body = (await response.json()) as { itemsPerPage: number };
    expect(body.itemsPerPage).toBe(3);
  });
});
