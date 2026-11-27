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

import { groups } from '@/lib/scim/lifecycle/groups';

const SCIM_GROUP = 'urn:ietf:params:scim:schemas:core:2.0:Group';
const PATCH_OP = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
const at = (url: string, init?: ConstructorParameters<typeof NextRequest>[1]) =>
  new NextRequest(`https://ops.example.test/api/scim/v2/Groups${url}`, init);
const write = (method: 'PUT' | 'PATCH', body: object) =>
  at('/g-1', {
    method,
    headers: { 'Content-Type': 'application/scim+json' },
    body: JSON.stringify(body),
  });

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

describe('SCIM group pushes with a member the connector does not know', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.tx.scimGroup.findFirst.mockResolvedValue({
      id: 'g-1',
      name: 'Ops',
      scimExternalId: null,
      memberships: [],
      bindings: [],
    });
    m.tx.scimGroup.update.mockResolvedValue({ id: 'g-1' });
    // u1 and u2 are provisioned; ghost never was.
    m.tx.scimIdentity.findMany.mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }]);
    m.tx.scimGroup.findUniqueOrThrow.mockResolvedValue(
      stored([{ userId: 'u1' }, { userId: 'u2' }])
    );
  });

  it('applies the provisioned members of a PUT and reports the skipped one', async () => {
    const response = await groups(
      write('PUT', {
        schemas: [SCIM_GROUP],
        displayName: 'Ops',
        members: [{ value: 'u1' }, { value: 'ghost' }, { value: 'u2' }],
      }),
      'g-1'
    );

    expect(response.status).toBe(200);
    expect(m.tx.scimGroupMembership.createMany).toHaveBeenCalledWith({
      data: [
        { groupId: 'g-1', userId: 'u1' },
        { groupId: 'g-1', userId: 'u2' },
      ],
      skipDuplicates: true,
    });
    expect(m.event).toHaveBeenCalledWith(
      m.tx,
      expect.anything(),
      'group.updated',
      'g-1',
      expect.objectContaining({
        members: 2,
        skippedUnprovisionedMembers: 1,
        skippedUnprovisionedMemberIds: ['ghost'],
      })
    );
  });

  it('does not fail a PATCH that adds an unknown member next to known ones', async () => {
    const response = await groups(
      write('PATCH', {
        schemas: [PATCH_OP],
        Operations: [{ op: 'add', path: 'members', value: [{ value: 'u1' }, { value: 'ghost' }] }],
      }),
      'g-1'
    );

    expect(response.status).toBe(200);
    expect(m.tx.scimGroupMembership.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: [{ groupId: 'g-1', userId: 'u1' }] })
    );
  });

  it('records nothing extra when every member is provisioned', async () => {
    await groups(
      write('PUT', { schemas: [SCIM_GROUP], displayName: 'Ops', members: [{ value: 'u1' }] }),
      'g-1'
    );
    const details = m.event.mock.calls[0][4] as Record<string, unknown>;
    expect(details).toEqual({ members: 1 });
  });
});
