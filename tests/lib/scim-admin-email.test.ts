import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const m = vi.hoisted(() => {
  const tx = {
    scimIdentity: { findFirst: vi.fn(), update: vi.fn() },
    scimConnector: { findUniqueOrThrow: vi.fn() },
    $queryRaw: vi.fn(),
    teamMember: { count: vi.fn() },
    escalationRule: { count: vi.fn() },
    team: { count: vi.fn() },
    onCallShift: { count: vi.fn() },
  };
  return {
    tx,
    refusedEvent: vi.fn(),
    updateUserSecurityState: vi.fn(),
  };
});

vi.mock('@/lib/prisma', () => ({ default: { scimEvent: { create: m.refusedEvent } } }));
vi.mock('@/lib/db-utils', () => ({
  runSerializableTransaction: async (operation: (tx: typeof m.tx) => unknown) => operation(m.tx),
}));
vi.mock('@/lib/users/admin-invariants', () => ({
  updateUserSecurityState: m.updateUserSecurityState,
}));
vi.mock('@/lib/session-security-projection', () => ({
  invalidateSessionSecurityProjection: vi.fn(),
}));
vi.mock('@/lib/scim/security/credentials', () => ({
  authorize: async () => ({ connectorId: 'conn-1', credentialId: 'cred-1' }),
  recheck: vi.fn(),
}));
vi.mock('@/lib/scim/protocol/origin', () => ({
  resolveScimPublicOrigin: async () => 'https://ops.example.test',
}));
vi.mock('@/lib/scim/lifecycle/events', () => ({ event: vi.fn() }));
vi.mock('@/lib/scim/lifecycle/membership', () => ({ reconcileTeam: vi.fn() }));
vi.mock('@/lib/scim/lifecycle/roles', () => ({ reconcileScimRoles: async () => [] }));

import { users } from '@/lib/scim/lifecycle/users';

const user = (role: 'ADMIN' | 'USER') => ({
  id: 'user-1',
  email: 'admin@example.com',
  name: 'Ada Admin',
  role,
  roleSource: 'MANUAL',
  status: 'ACTIVE',
  jobTitle: null,
  department: null,
  scimGivenName: null,
  scimFamilyName: null,
  avatarUrl: null,
  tokenVersion: 1,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
});

const patch = (userName: string) =>
  new NextRequest('https://ops.example.test/api/scim/v2/Users/user-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/scim+json' },
    body: JSON.stringify({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      Operations: [{ op: 'replace', path: 'userName', value: userName }],
    }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  m.tx.scimConnector.findUniqueOrThrow.mockResolvedValue({
    profileFields: ['name', 'email', 'title', 'department', 'photos'],
  });
  m.tx.$queryRaw.mockResolvedValue([]);
  m.tx.teamMember.count.mockResolvedValue(0);
  m.tx.escalationRule.count.mockResolvedValue(0);
  m.tx.team.count.mockResolvedValue(0);
  m.tx.onCallShift.count.mockResolvedValue(0);
  m.updateUserSecurityState.mockImplementation(async (_id, _state, profile) => ({
    ...user('USER'),
    ...profile,
  }));
});

describe('SCIM userName change', () => {
  it('refuses to move an administrator email and records the refusal', async () => {
    m.tx.scimIdentity.findFirst.mockResolvedValue({
      id: 'identity-1',
      externalId: 'ext-1',
      user: user('ADMIN'),
    });

    await expect(users(patch('attacker@evil.example'), 'user-1')).rejects.toMatchObject({
      status: 400,
      scimType: 'mutability',
    });

    expect(m.updateUserSecurityState).not.toHaveBeenCalled();
    expect(m.refusedEvent).toHaveBeenCalledWith({
      data: expect.objectContaining({
        connectorId: 'conn-1',
        action: 'user.update_refused',
        resourceId: 'user-1',
        details: expect.objectContaining({ reason: 'administrator_email_change' }),
      }),
    });
  });

  it('still answers 400 when the refusal record cannot be written', async () => {
    m.tx.scimIdentity.findFirst.mockResolvedValue({
      id: 'identity-1',
      externalId: 'ext-1',
      user: user('ADMIN'),
    });
    m.refusedEvent.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(users(patch('attacker@evil.example'), 'user-1')).rejects.toMatchObject({
      status: 400,
      scimType: 'mutability',
    });
    expect(m.updateUserSecurityState).not.toHaveBeenCalled();
  });

  it('still changes the email of an ordinary user', async () => {
    m.tx.scimIdentity.findFirst.mockResolvedValue({
      id: 'identity-1',
      externalId: 'ext-1',
      user: user('USER'),
    });

    const response = await users(patch('renamed@example.com'), 'user-1');

    expect(response.status).toBe(200);
    expect(m.updateUserSecurityState).toHaveBeenCalledTimes(1);
    expect(m.updateUserSecurityState.mock.calls[0][2]).toMatchObject({
      email: 'renamed@example.com',
    });
    expect(m.refusedEvent).not.toHaveBeenCalled();
  });

  it('lets an administrator keep their email when the directory sends it again', async () => {
    m.tx.scimIdentity.findFirst.mockResolvedValue({
      id: 'identity-1',
      externalId: 'ext-1',
      user: user('ADMIN'),
    });

    await expect(users(patch('Admin@Example.com'), 'user-1')).resolves.toMatchObject({
      status: 200,
    });
    expect(m.refusedEvent).not.toHaveBeenCalled();
  });
});
