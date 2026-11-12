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

describe('access notifications open the right page', () => {
  it('sends approvers to the request and holders to their own access page', async () => {
    const { inAppNotificationHref, inAppNotificationKind } =
      await import('@/lib/notification-links');
    expect(inAppNotificationHref({ entityType: 'ACCESS_REQUEST', entityId: 'req_1' })).toBe(
      '/settings/access/requests?request=req_1#request-req_1'
    );
    expect(inAppNotificationHref({ entityType: 'ACCESS_REQUEST_DECIDED', entityId: 'req_1' })).toBe(
      '/settings/access'
    );
    expect(inAppNotificationHref({ entityType: 'ACCESS_GRANT_ENDED', entityId: 'g' })).toBe(
      '/settings/access'
    );
    expect(inAppNotificationHref({ entityType: 'ACCESS_GRANT', entityId: 'g' })).toBe(
      '/settings/access/admin#temporary-access'
    );
    expect(inAppNotificationHref({ entityType: 'ACCESS_REVIEW', entityId: 'r' })).toBe(
      '/settings/access/admin#access-reviews'
    );
    // Security notices are never shown as incidents.
    expect(inAppNotificationKind('SECURITY')).toBe('system');
    expect(inAppNotificationKind('INCIDENT')).toBe('incident');
    expect(inAppNotificationKind('SOMETHING_NEW')).toBe('system');
  });
});

describe('read-only approvers', () => {
  it('does not let read-only team owners approve', async () => {
    const tx = {
      teamMember: { findUnique: vi.fn(async () => ({ role: 'OWNER' })) },
    } as never;
    await expect(
      approverCanDecide(
        tx,
        { id: 'auditor', isOrgAdmin: false, recentlyAuthenticated: true, canManageTeams: false },
        { requesterId: 'req', kind: 'TEAM_MEMBERSHIP', teamId: 't', requestedTeamRole: 'MEMBER' },
        false
      )
    ).resolves.toMatchObject({ allowed: false, code: 'AUTHORIZATION_DENIED' });
  });
});

describe('on-call responders and emergency access', () => {
  it('lets the person an incident pages open it, and honours incident-scoped emergency access', async () => {
    const { authorize, AUTHORIZATION_ACTIONS } = await import('@/lib/authorization-policy');
    const actor = { id: 'u', role: 'USER' as const, status: 'ACTIVE' as const, teamIds: [] };
    const base = {
      type: 'incident' as const,
      id: 'inc',
      visibility: 'PUBLIC' as const,
      serviceTeamId: 'other',
    };
    expect(
      authorize({ actor, action: AUTHORIZATION_ACTIONS.INCIDENT_READ, resource: base }).allowed
    ).toBe(false);
    expect(
      authorize({
        actor,
        action: AUTHORIZATION_ACTIONS.INCIDENT_READ,
        resource: { ...base, onCallUserIds: ['u'] },
      }).allowed
    ).toBe(true);
    const elevated = { ...actor, elevatedIncidentIds: ['inc'] };
    expect(
      authorize({ actor: elevated, action: AUTHORIZATION_ACTIONS.INCIDENT_READ, resource: base })
        .allowed
    ).toBe(true);
    expect(
      authorize({
        actor: elevated,
        action: AUTHORIZATION_ACTIONS.INCIDENT_READ,
        resource: { ...base, id: 'other' },
      }).allowed
    ).toBe(false);
  });
});

describe('role coverage', () => {
  it('compares permission sets, not rank', async () => {
    const { roleCovers } = await import('@/lib/authorization');
    expect(roleCovers('ADMIN', 'AUDITOR')).toBe(true);
    expect(roleCovers('ADMIN', 'RESPONDER')).toBe(true);
    // Responders lack Auditor-only audit/compliance permissions, and vice versa.
    expect(roleCovers('RESPONDER', 'AUDITOR')).toBe(false);
    expect(roleCovers('AUDITOR', 'RESPONDER')).toBe(false);
    expect(roleCovers('USER', 'USER')).toBe(true);
    expect(roleCovers('USER', 'RESPONDER')).toBe(false);
    expect(roleCovers('nonsense', 'USER')).toBe(false);
  });
});
