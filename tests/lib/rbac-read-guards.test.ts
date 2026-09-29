import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getServerSession } from 'next-auth';
import prisma from '@/lib/prisma';
import {
  assertCanListPolicies,
  assertCanListUsers,
  assertCanViewPolicy,
  assertCanViewUser,
} from '@/lib/rbac';

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({ getAuthOptions: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/prisma', () => ({
  default: { user: { findUnique: vi.fn() } },
}));

const privilegedRoles = ['ADMIN', 'RESPONDER', 'AUDITOR'] as const;
const guards = [
  ['list users', () => assertCanListUsers()],
  ['view user', () => assertCanViewUser('target-user')],
  ['list policies', () => assertCanListPolicies()],
  ['view policy', () => assertCanViewPolicy('target-policy')],
] as const;

function mockAuthenticatedRole(role: 'ADMIN' | 'RESPONDER' | 'AUDITOR' | 'USER') {
  vi.mocked(getServerSession).mockResolvedValue({
    user: { id: `${role.toLowerCase()}-1`, email: `${role.toLowerCase()}@example.com` },
  });
  vi.mocked(prisma.user.findUnique).mockResolvedValue({
    id: `${role.toLowerCase()}-1`,
    email: `${role.toLowerCase()}@example.com`,
    name: role,
    role,
    status: 'ACTIVE',
    tokenVersion: 0,
  } as never);
}

describe('organization-wide read guards', () => {
  beforeEach(() => vi.clearAllMocks());

  for (const role of privilegedRoles) {
    for (const [name, guard] of guards) {
      it(`allows ${role} to ${name}`, async () => {
        mockAuthenticatedRole(role);
        await expect(guard()).resolves.toMatchObject({ role });
      });
    }
  }

  for (const [name, guard] of guards) {
    it(`denies USER permission to ${name}`, async () => {
      mockAuthenticatedRole('USER');
      await expect(guard()).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
    });

    it(`requires authentication to ${name}`, async () => {
      vi.mocked(getServerSession).mockResolvedValue(null);
      await expect(guard()).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
    });
  }
});
