import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ default: {} }));

import { approverCanDecide, describeAccessRequest, safeOriginPath } from '@/lib/access/requests';
import { isRecentAuthentication } from '@/lib/access/step-up';

function fakeTx(options: {
  selfApprovalAllowed?: boolean;
  otherApprover?: boolean;
  teamRole?: 'OWNER' | 'ADMIN' | 'MEMBER' | null;
}) {
  return {
    systemSettings: {
      findUnique: vi.fn(async () => ({
        accessSelfApprovalAllowed: options.selfApprovalAllowed ?? false,
      })),
    },
    user: { findFirst: vi.fn(async () => (options.otherApprover ? { id: 'other' } : null)) },
    teamMember: {
      findUnique: vi.fn(async () => (options.teamRole ? { role: options.teamRole } : null)),
    },
  } as never;
}

describe('who may approve an access request', () => {
  const teamRequest = {
    requesterId: 'req',
    kind: 'TEAM_MEMBERSHIP',
    teamId: 'team-1',
    requestedTeamRole: 'MEMBER' as const,
  };
  const orgRequest = {
    requesterId: 'req',
    kind: 'ORG_ROLE',
    teamId: null,
    requestedTeamRole: null,
  };
  const approver = (isOrgAdmin: boolean) => ({
    id: 'appr',
    isOrgAdmin,
    recentlyAuthenticated: true,
  });

  it('lets org admins approve anything', async () => {
    await expect(approverCanDecide(fakeTx({}), approver(true), orgRequest, false)).resolves.toEqual(
      { allowed: true }
    );
    await expect(
      approverCanDecide(fakeTx({}), approver(true), teamRequest, false)
    ).resolves.toEqual({ allowed: true });
  });

  it('lets team owners and team admins approve membership', async () => {
    for (const teamRole of ['OWNER', 'ADMIN'] as const) {
      await expect(
        approverCanDecide(fakeTx({ teamRole }), approver(false), teamRequest, false)
      ).resolves.toEqual({
        allowed: true,
      });
    }
  });

  it('only lets team owners approve new owners', async () => {
    const ownerRequest = { ...teamRequest, kind: 'TEAM_ROLE', requestedTeamRole: 'OWNER' as const };
    await expect(
      approverCanDecide(fakeTx({ teamRole: 'ADMIN' }), approver(false), ownerRequest, false)
    ).resolves.toMatchObject({
      allowed: false,
    });
    await expect(
      approverCanDecide(fakeTx({ teamRole: 'OWNER' }), approver(false), ownerRequest, false)
    ).resolves.toEqual({
      allowed: true,
    });
  });

  it('refuses members and non-admins for role changes', async () => {
    await expect(
      approverCanDecide(fakeTx({ teamRole: 'MEMBER' }), approver(false), teamRequest, false)
    ).resolves.toMatchObject({
      allowed: false,
      code: 'AUTHORIZATION_DENIED',
    });
    await expect(
      approverCanDecide(fakeTx({ teamRole: 'OWNER' }), approver(false), orgRequest, false)
    ).resolves.toMatchObject({
      allowed: false,
    });
  });

  it('refuses approving your own request unless the policy allows it', async () => {
    const own = { ...orgRequest, requesterId: 'appr' };
    await expect(approverCanDecide(fakeTx({}), approver(true), own, false)).resolves.toMatchObject({
      allowed: false,
      code: 'SEPARATION_OF_DUTIES',
    });
    await expect(approverCanDecide(fakeTx({}), approver(true), own, true)).resolves.toEqual({
      allowed: true,
    });
  });
});

describe('access request helpers', () => {
  it('describes requests in plain language', () => {
    expect(
      describeAccessRequest({
        kind: 'ORG_ROLE',
        requestedRole: 'RESPONDER',
        requestedTeamRole: null,
        durationMinutes: 480,
      })
    ).toBe('Responder role for 8 hours');
    expect(
      describeAccessRequest({
        kind: 'TEAM_MEMBERSHIP',
        requestedRole: null,
        requestedTeamRole: 'MEMBER',
        durationMinutes: null,
        team: { name: 'Payments' },
      })
    ).toBe('Join "Payments" as member permanently');
  });

  it('only keeps same-origin return paths', () => {
    expect(safeOriginPath('/audit?x=1')).toBe('/audit?x=1');
    expect(safeOriginPath('//evil.example')).toBeNull();
    expect(safeOriginPath('https://evil.example')).toBeNull();
    expect(safeOriginPath('/\\evil')).toBeNull();
    expect(safeOriginPath(undefined)).toBeNull();
  });

  it('requires a recent sign-in for step-up', () => {
    const now = Date.now();
    expect(isRecentAuthentication(now - 60_000, 15 * 60_000, now)).toBe(true);
    expect(isRecentAuthentication(now - 20 * 60_000, 15 * 60_000, now)).toBe(false);
    expect(isRecentAuthentication(undefined, 15 * 60_000, now)).toBe(false);
    expect(isRecentAuthentication(now + 10 * 60_000, 15 * 60_000, now)).toBe(false);
  });
});
