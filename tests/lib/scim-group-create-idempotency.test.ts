import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const m = vi.hoisted(() => {
  const tx = {
    scimGroup: {
      findFirst: vi.fn(),
      create: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    scimIdentity: { count: vi.fn() },
    scimGroupMembership: { deleteMany: vi.fn(), createMany: vi.fn() },
  };
  return { tx };
});

vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('@/lib/db-utils', () => ({
  runSerializableTransaction: async (operation: (tx: typeof m.tx) => unknown) => operation(m.tx),
}));
vi.mock('@/lib/session-security-projection', () => ({
  invalidateSessionSecurityProjections: vi.fn(),
}));
vi.mock('@/lib/scim/security/credentials', () => ({
  authorize: async () => ({ connectorId: 'conn-1' }),
  recheck: vi.fn(),
}));
vi.mock('@/lib/scim/protocol/origin', () => ({
  resolveScimPublicOrigin: async () => 'https://ops.example.test',
}));
vi.mock('@/lib/scim/lifecycle/roles', () => ({ reconcileScimRoles: async () => [] }));
vi.mock('@/lib/scim/lifecycle/events', () => ({ event: vi.fn() }));
vi.mock('@/lib/scim/lifecycle/membership', () => ({ reconcileTeam: vi.fn() }));

import { groups } from '@/lib/scim/lifecycle/groups';

const post = (body: object) =>
  new NextRequest('https://ops.example.test/api/scim/v2/Groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/scim+json' },
    body: JSON.stringify({
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
      ...body,
    }),
  });

describe('SCIM POST /Groups without an externalId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.tx.scimIdentity.count.mockResolvedValue(0);
    m.tx.scimGroup.create.mockResolvedValue({ id: 'g-new' });
    m.tx.scimGroup.findUniqueOrThrow.mockResolvedValue({
      id: 'g-new',
      name: 'Ops',
      scimExternalId: null,
      memberships: [],
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
  });

  it('answers 409 uniqueness for a retry of a group that already exists', async () => {
    m.tx.scimGroup.findFirst.mockResolvedValue({ id: 'g-1' });

    await expect(groups(post({ displayName: 'Ops' }))).rejects.toMatchObject({
      status: 409,
      scimType: 'uniqueness',
    });
    expect(m.tx.scimGroup.create).not.toHaveBeenCalled();
    expect(m.tx.scimGroup.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { connectorId: 'conn-1', name: 'Ops', scimExternalId: null },
      })
    );
  });

  it('creates the group when no group of that name exists', async () => {
    m.tx.scimGroup.findFirst.mockResolvedValue(null);

    const response = await groups(post({ displayName: 'Ops' }));

    expect(response.status).toBe(201);
    expect(m.tx.scimGroup.create).toHaveBeenCalledTimes(1);
  });

  it('leaves groups that carry an externalId to the unique index', async () => {
    const response = await groups(post({ displayName: 'Ops', externalId: 'dir-1' }));

    expect(response.status).toBe(201);
    expect(m.tx.scimGroup.findFirst).not.toHaveBeenCalled();
  });
});
