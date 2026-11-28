import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  capabilities: [] as string[],
  canViewTeam: true,
  teamFindUnique: vi.fn(),
  userFindMany: vi.fn(),
}));

vi.mock('react', async importOriginal => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <T>(fn: T) => fn,
}));
vi.mock('next/headers', () => ({ headers: vi.fn() }));
vi.mock('next/navigation', () => ({ forbidden: vi.fn(), redirect: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/request-actor-context', () => ({
  getRequestActorContext: async () => ({ user: { id: 'u1' } }),
}));
vi.mock('@/lib/access/settings', () => ({ getAccessControlSettings: async () => ({}) }));
vi.mock('@/lib/access/effective', () => ({
  effectiveAccessSelect: () => ({ customRole: true }),
  resolveEffectiveAccess: () => ({
    baseRole: 'USER',
    role: 'USER',
    capabilities: new Set(mocks.capabilities),
    customRole: null,
  }),
}));
vi.mock('@/lib/rbac', () => ({
  assertCanViewTeam: async () => {
    if (!mocks.canViewTeam) throw new Error('denied');
  },
}));
vi.mock('@/lib/prisma', () => ({
  default: {
    user: {
      findUnique: async () => ({
        id: 'u1',
        role: 'USER',
        roleSource: 'MANUAL',
        teamMemberships: [],
        customRole: null,
        accessGrants: [],
      }),
      findMany: (...args: unknown[]) => mocks.userFindMany(...args),
    },
    team: { findUnique: (...args: unknown[]) => mocks.teamFindUnique(...args) },
  },
}));

import { explainAccessForPath } from '@/lib/access/server';

const owner = { id: 'o1', name: 'Olive Owner', email: 'olive@example.com', avatarUrl: null };

describe('explainAccessForPath', () => {
  beforeEach(() => {
    mocks.capabilities = ['incident.read.scoped'];
    mocks.canViewTeam = false;
    mocks.teamFindUnique.mockReset().mockImplementation(async (args: { select: object }) =>
      'members' in args.select
        ? { name: 'Payments', members: [{ role: 'OWNER', user: owner }] }
        : { id: 't1', name: 'Payments' }
    );
    mocks.userFindMany.mockReset().mockResolvedValue([owner]);
  });

  it('withholds names and emails from people who cannot read the user directory', async () => {
    const explanation = await explainAccessForPath('/teams/t1');
    expect(explanation.resourceDenied).toBe(true);
    expect(explanation.owningTeam).toEqual({ id: 't1', name: 'Payments' });
    expect(explanation.grantors.people).toEqual([]);
    expect(JSON.stringify(explanation)).not.toContain('olive@example.com');
    expect(mocks.userFindMany).not.toHaveBeenCalled();
  });

  it('does not treat a team the person can open as a denial or reveal its owners', async () => {
    mocks.canViewTeam = true;
    const explanation = await explainAccessForPath('/teams/t1');
    expect(explanation.resourceDenied).toBe(false);
    expect(explanation.owningTeam).toBeNull();
    expect(explanation.resourceId).toBeNull();
    expect(explanation.grantors.people).toEqual([]);
  });

  it('still lists grantors for people with user.read.all', async () => {
    mocks.capabilities = ['user.read.all'];
    const explanation = await explainAccessForPath('/teams/t1');
    expect(explanation.grantors.people.map(person => person.email)).toEqual(['olive@example.com']);
  });
});
