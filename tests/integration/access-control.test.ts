import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { createTestUser, resetDatabase, testPrisma as db } from '../helpers/test-db';
import { resolveUserActor } from '@/lib/authorization-actors';
import { AUTHORIZATION_ACTIONS, authorize } from '@/lib/authorization-policy';
import { CAPABILITIES } from '@/lib/authorization';
import { createAccessRequest, decideAccessRequest } from '@/lib/access/requests';
import {
  activateBreakGlass,
  processEndedAccessGrants,
  revokeAccessGrant,
} from '@/lib/access/grants';
import {
  archiveCustomRole,
  assignCustomRole,
  cancelAccessReview,
  checkAccess,
  completeAccessReview,
  decideAccessReviewItem,
  saveCustomRole,
  startAccessReview,
} from '@/lib/access/admin';
import { setTeamMembership } from '@/lib/teams/administration';
import { invalidateAccessControlSettings } from '@/lib/access/settings';

const approver = (id: string, isOrgAdmin: boolean) => ({
  id,
  isOrgAdmin,
  recentlyAuthenticated: true,
});

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
  invalidateAccessControlSettings();
});

async function incidentOnTeam(teamId: string) {
  const service = await db.service.create({ data: { name: `svc-${Math.random()}`, teamId } });
  return db.incident.create({
    data: { title: 'Checkout down', serviceId: service.id, status: 'OPEN', urgency: 'HIGH' },
  });
}

describe('time-bound team access through a request', () => {
  it('routes to the team owner, grants membership, enables incident work, and reverts on expiry', async () => {
    const owner = await createTestUser();
    const requester = await createTestUser();
    const team = await db.team.create({ data: { name: 'Payments' } });
    await db.teamMember.create({ data: { teamId: team.id, userId: owner.id, role: 'OWNER' } });
    const incident = await incidentOnTeam(team.id);

    const before = await resolveUserActor(requester.id);
    const resource = {
      type: 'incident' as const,
      id: incident.id,
      visibility: 'PUBLIC' as const,
      serviceTeamId: team.id,
      watcherIds: [],
    };
    expect(
      authorize({ actor: before!, action: AUTHORIZATION_ACTIONS.INCIDENT_ACKNOWLEDGE, resource })
        .allowed
    ).toBe(false);

    const request = await createAccessRequest(requester.id, {
      kind: 'TEAM_MEMBERSHIP',
      teamId: team.id,
      requestedTeamRole: 'MEMBER',
      reason: 'On call for payments this week',
      durationMinutes: 60,
      originPath: `/incidents/${incident.id}`,
    });
    expect(
      await db.inAppNotification.count({ where: { userId: owner.id, entityId: request.id } })
    ).toBe(1);

    // Duplicate open requests are refused.
    await expect(
      createAccessRequest(requester.id, {
        kind: 'TEAM_MEMBERSHIP',
        teamId: team.id,
        requestedTeamRole: 'MEMBER',
        reason: 'Asking again for the same thing',
        durationMinutes: 60,
      })
    ).rejects.toMatchObject({ code: 'RESOURCE_CONFLICT' });

    await decideAccessRequest(approver(owner.id, false), request.id, { approve: true });
    const grant = await db.accessGrant.findFirstOrThrow({ where: { userId: requester.id } });
    expect(grant).toMatchObject({ teamId: team.id, teamRole: 'MEMBER', createdMembership: true });

    const during = await resolveUserActor(requester.id);
    expect(during!.teamIds).toContain(team.id);
    expect(
      authorize({ actor: during!, action: AUTHORIZATION_ACTIONS.INCIDENT_ACKNOWLEDGE, resource })
        .allowed
    ).toBe(true);
    expect(
      authorize({ actor: during!, action: AUTHORIZATION_ACTIONS.INCIDENT_MANAGE, resource }).allowed
    ).toBe(false);

    await db.accessGrant.update({
      where: { id: grant.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await processEndedAccessGrants();
    expect(
      await db.teamMember.findUnique({
        where: { userId_teamId: { userId: requester.id, teamId: team.id } },
      })
    ).toBeNull();
    expect(await db.auditLog.count({ where: { action: 'access.grant.ended.expired' } })).toBe(1);
    expect(
      await db.inAppNotification.count({
        where: { userId: requester.id, title: 'Temporary access ended' },
      })
    ).toBe(1);
  });

  it('keeps team members from approving and team admins from granting ownership', async () => {
    const owner = await createTestUser();
    const teamAdmin = await createTestUser();
    const member = await createTestUser();
    const requester = await createTestUser();
    const team = await db.team.create({ data: { name: 'Infra' } });
    await db.teamMember.createMany({
      data: [
        { teamId: team.id, userId: owner.id, role: 'OWNER' },
        { teamId: team.id, userId: teamAdmin.id, role: 'ADMIN' },
        { teamId: team.id, userId: member.id, role: 'MEMBER' },
        { teamId: team.id, userId: requester.id, role: 'MEMBER' },
      ],
    });
    const request = await createAccessRequest(requester.id, {
      kind: 'TEAM_ROLE',
      teamId: team.id,
      requestedTeamRole: 'OWNER',
      reason: 'Taking over ownership of infra',
      durationMinutes: null,
    });
    await expect(
      decideAccessRequest(approver(member.id, false), request.id, { approve: true })
    ).rejects.toMatchObject({
      code: 'AUTHORIZATION_DENIED',
    });
    await expect(
      decideAccessRequest(approver(teamAdmin.id, false), request.id, { approve: true })
    ).rejects.toMatchObject({
      code: 'AUTHORIZATION_DENIED',
    });
    await decideAccessRequest(approver(owner.id, false), request.id, { approve: true });
    expect(
      await db.teamMember.findUniqueOrThrow({
        where: { userId_teamId: { userId: requester.id, teamId: team.id } },
      })
    ).toMatchObject({ role: 'OWNER' });
  });
});

describe('team admin role', () => {
  it('manages members but cannot add, change or remove owners', async () => {
    const owner = await createTestUser();
    const teamAdmin = await createTestUser();
    const newcomer = await createTestUser();
    const team = await db.team.create({ data: { name: 'Mobile' } });
    await db.teamMember.createMany({
      data: [
        { teamId: team.id, userId: owner.id, role: 'OWNER' },
        { teamId: team.id, userId: teamAdmin.id, role: 'ADMIN' },
      ],
    });
    await setTeamMembership(team.id, newcomer.id, { role: 'MEMBER' }, { id: teamAdmin.id });
    await setTeamMembership(team.id, newcomer.id, { role: 'ADMIN' }, { id: teamAdmin.id });
    await expect(
      setTeamMembership(team.id, newcomer.id, { role: 'OWNER' }, { id: teamAdmin.id })
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
    await expect(
      setTeamMembership(team.id, owner.id, { role: 'MEMBER' }, { id: teamAdmin.id })
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
    await setTeamMembership(team.id, newcomer.id, { role: 'OWNER' }, { id: owner.id });
  });
});

describe('organization role requests', () => {
  it('grants temporary Responder access, honours revocation, and enforces separation of duties', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const otherAdmin = await createTestUser({ role: 'ADMIN' });
    const user = await createTestUser();

    const request = await createAccessRequest(user.id, {
      kind: 'ORG_ROLE',
      requestedRole: 'RESPONDER',
      reason: 'Covering the incident rotation',
      durationMinutes: 480,
    });
    await decideAccessRequest(approver(admin.id, true), request.id, { approve: true });
    const elevated = await resolveUserActor(user.id);
    expect(elevated!.role).toBe('RESPONDER');
    expect(elevated!.capabilities!.has(CAPABILITIES.OPERATIONS_MANAGE)).toBe(true);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).role).toBe('USER');

    const grant = await db.accessGrant.findFirstOrThrow({ where: { userId: user.id } });
    await revokeAccessGrant({
      grantId: grant.id,
      actorId: user.id,
      reason: 'Done',
      isAdmin: false,
    });
    expect((await resolveUserActor(user.id))!.role).toBe('USER');

    // Asking for a role you already exceed is refused outright.
    await expect(
      createAccessRequest(otherAdmin.id, {
        kind: 'ORG_ROLE',
        requestedRole: 'AUDITOR',
        reason: 'Need auditor view for a review',
        durationMinutes: 60,
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    // An admin may not approve their own request while another admin exists.
    const sodTeam = await db.team.create({ data: { name: 'SoD team' } });
    const own = await createAccessRequest(otherAdmin.id, {
      kind: 'TEAM_MEMBERSHIP',
      teamId: sodTeam.id,
      requestedTeamRole: 'MEMBER',
      reason: 'Joining to help with the review',
      durationMinutes: 60,
    });
    await expect(
      decideAccessRequest(approver(otherAdmin.id, true), own.id, { approve: true })
    ).rejects.toMatchObject({
      code: 'SEPARATION_OF_DUTIES',
    });
  });

  it('refuses role requests for identity-provider managed roles', async () => {
    const user = await createTestUser({ roleSource: 'OIDC' });
    await expect(
      createAccessRequest(user.id, {
        kind: 'ORG_ROLE',
        requestedRole: 'RESPONDER',
        reason: 'I would like more access',
        durationMinutes: null,
      })
    ).rejects.toMatchObject({ code: 'ACCESS_FEATURE_DISABLED' });
  });

  it('requires a recent sign-in to grant Admin', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const user = await createTestUser();
    const request = await createAccessRequest(user.id, {
      kind: 'ORG_ROLE',
      requestedRole: 'ADMIN',
      reason: 'Temporary admin to rotate keys',
      durationMinutes: 60,
    });
    await expect(
      decideAccessRequest(
        { id: admin.id, isOrgAdmin: true, recentlyAuthenticated: false },
        request.id,
        {
          approve: true,
        }
      )
    ).rejects.toMatchObject({ code: 'STEP_UP_REQUIRED' });
  });
});

describe('break-glass access', () => {
  it('elevates for one incident, alerts admins, and is rate limited', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const user = await createTestUser();
    const team = await db.team.create({ data: { name: 'Elsewhere' } });
    const incident = await incidentOnTeam(team.id);

    await activateBreakGlass({
      userId: user.id,
      reason: 'Checkout is down and on-call is unreachable',
      minutes: 30,
      incidentId: incident.id,
    });
    const actor = await resolveUserActor(user.id);
    expect(actor!.role).toBe('USER');
    expect(actor!.elevatedIncidentIds).toEqual([incident.id]);
    expect(
      authorize({
        actor: actor!,
        action: AUTHORIZATION_ACTIONS.INCIDENT_MANAGE,
        resource: {
          type: 'incident',
          id: incident.id,
          visibility: 'PUBLIC',
          serviceTeamId: team.id,
        },
      }).allowed
    ).toBe(true);
    expect(
      await db.inAppNotification.count({
        where: { userId: admin.id, title: 'Emergency access activated' },
      })
    ).toBe(1);

    await activateBreakGlass({
      userId: user.id,
      reason: 'Second emergency today, still down',
      minutes: 15,
    });
    await activateBreakGlass({
      userId: user.id,
      reason: 'Third emergency today, still down',
      minutes: 15,
    });
    await expect(
      activateBreakGlass({
        userId: user.id,
        reason: 'Fourth emergency today, still down',
        minutes: 15,
      })
    ).rejects.toMatchObject({ code: 'ACCESS_REQUEST_LIMITED' });
  });
});

describe('custom roles', () => {
  it('adds permissions on top of a role and never grants administration', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const auditor = await createTestUser({ role: 'AUDITOR' });
    await expect(
      saveCustomRole(admin.id, { name: 'Sneaky', capabilities: ['admin.manage'] })
    ).rejects.toThrow();
    const role = await saveCustomRole(admin.id, {
      name: 'Runbook operator',
      capabilities: ['runbook.execute'],
    });
    await assignCustomRole(admin.id, auditor.id, role.id);
    expect(
      (await resolveUserActor(auditor.id))!.capabilities!.has(CAPABILITIES.RUNBOOK_EXECUTE)
    ).toBe(true);

    const check = await checkAccess({
      kind: 'capability',
      userId: auditor.id,
      capability: 'runbook.execute',
    });
    expect(check.allowed).toBe(true);
    expect(check.steps.map(step => step.detail).join(' ')).toContain('Runbook operator');

    await archiveCustomRole(admin.id, role.id);
    expect(
      (await resolveUserActor(auditor.id))!.capabilities!.has(CAPABILITIES.RUNBOOK_EXECUTE)
    ).toBe(false);
  });
});

describe('access reviews', () => {
  it('certifies privileged access, blocks self-certification, and keeps the last admin', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const reviewer = await createTestUser({ role: 'ADMIN' });
    const responder = await createTestUser({ role: 'RESPONDER' });
    const review = await startAccessReview(reviewer.id, { name: 'Q4 review' });
    const items = await db.accessReviewItem.findMany({ where: { reviewId: review.id } });
    expect(items.map(item => item.userId).sort()).toEqual(
      [admin.id, reviewer.id, responder.id].sort()
    );

    const own = items.find(item => item.userId === reviewer.id)!;
    await expect(decideAccessReviewItem(reviewer.id, own.id, 'KEEP')).rejects.toMatchObject({
      code: 'SEPARATION_OF_DUTIES',
    });
    await decideAccessReviewItem(admin.id, own.id, 'REVOKE');
    await decideAccessReviewItem(
      reviewer.id,
      items.find(item => item.userId === admin.id)!.id,
      'REVOKE'
    );
    await decideAccessReviewItem(
      reviewer.id,
      items.find(item => item.userId === responder.id)!.id,
      'REVOKE'
    );

    const result = await completeAccessReview(reviewer.id, review.id);
    // Both admins were marked for removal; one must remain.
    const admins = await db.user.count({ where: { role: 'ADMIN', status: 'ACTIVE' } });
    expect(admins).toBe(1);
    expect((await db.user.findUniqueOrThrow({ where: { id: responder.id } })).role).toBe('USER');
    expect(result.revoked).toBe(2);
    expect(await db.auditLog.count({ where: { action: 'access_review.completed' } })).toBe(1);
  });
});

describe('audit fixes', () => {
  it('links the approver notification to the request, and closes stale requests without demoting', async () => {
    const { inAppNotificationHref } = await import('@/lib/notification-links');
    const owner = await createTestUser();
    const requester = await createTestUser();
    const team = await db.team.create({ data: { name: 'Stale requests' } });
    await db.teamMember.create({ data: { teamId: team.id, userId: owner.id, role: 'OWNER' } });
    const request = await createAccessRequest(requester.id, {
      kind: 'TEAM_MEMBERSHIP',
      teamId: team.id,
      requestedTeamRole: 'MEMBER',
      reason: 'Need to see payments incidents',
      durationMinutes: null,
    });
    const notification = await db.inAppNotification.findFirstOrThrow({
      where: { userId: owner.id, entityId: request.id },
    });
    expect(inAppNotificationHref(notification)).toBe(
      `/settings/access/requests?request=${request.id}#request-${request.id}`
    );
    // Meanwhile the owner adds them directly as a team admin.
    await db.teamMember.create({ data: { teamId: team.id, userId: requester.id, role: 'ADMIN' } });
    await expect(
      decideAccessRequest(approver(owner.id, false), request.id, { approve: true })
    ).rejects.toMatchObject({ code: 'RESOURCE_CONFLICT' });
    expect(
      await db.teamMember.findUniqueOrThrow({
        where: { userId_teamId: { userId: requester.id, teamId: team.id } },
      })
    ).toMatchObject({ role: 'ADMIN' });
    expect(await db.accessRequest.findUniqueOrThrow({ where: { id: request.id } })).toMatchObject({
      status: 'CANCELLED',
    });
  });

  it('records an expired request as expired when someone tries to decide it', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const user = await createTestUser();
    const request = await createAccessRequest(user.id, {
      kind: 'ORG_ROLE',
      requestedRole: 'AUDITOR',
      reason: 'Quarterly audit preparation',
      durationMinutes: 60,
    });
    await db.accessRequest.update({
      where: { id: request.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(
      decideAccessRequest(approver(admin.id, true), request.id, { approve: true })
    ).rejects.toMatchObject({ code: 'RESOURCE_CONFLICT' });
    expect((await db.accessRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe(
      'EXPIRED'
    );
  });

  it('lets identity-provider managed users ask for temporary, not permanent, role access', async () => {
    const user = await createTestUser({ roleSource: 'OIDC' });
    await expect(
      createAccessRequest(user.id, {
        kind: 'ORG_ROLE',
        requestedRole: 'RESPONDER',
        reason: 'Covering the weekend rotation',
        durationMinutes: null,
      })
    ).rejects.toMatchObject({ code: 'ACCESS_FEATURE_DISABLED' });
    await expect(
      createAccessRequest(user.id, {
        kind: 'ORG_ROLE',
        requestedRole: 'RESPONDER',
        reason: 'Covering the weekend rotation',
        durationMinutes: 480,
      })
    ).resolves.toMatchObject({ status: 'PENDING' });
  });

  it('does not route team requests to read-only owners', async () => {
    const auditorOwner = await createTestUser({ role: 'AUDITOR' });
    const admin = await createTestUser({ role: 'ADMIN' });
    const requester = await createTestUser();
    const team = await db.team.create({ data: { name: 'Audited team' } });
    await db.teamMember.create({
      data: { teamId: team.id, userId: auditorOwner.id, role: 'OWNER' },
    });
    const request = await createAccessRequest(requester.id, {
      kind: 'TEAM_MEMBERSHIP',
      teamId: team.id,
      requestedTeamRole: 'MEMBER',
      reason: 'Joining to help with incidents',
      durationMinutes: null,
    });
    expect(
      await db.inAppNotification.count({ where: { userId: auditorOwner.id, entityId: request.id } })
    ).toBe(0);
    expect(
      await db.inAppNotification.count({ where: { userId: admin.id, entityId: request.id } })
    ).toBe(1);
  });

  it('restores the original team state when overlapping temporary grants end', async () => {
    const owner = await createTestUser();
    const user = await createTestUser();
    const team = await db.team.create({ data: { name: 'Overlap' } });
    await db.teamMember.create({ data: { teamId: team.id, userId: owner.id, role: 'OWNER' } });
    const join = await createAccessRequest(user.id, {
      kind: 'TEAM_MEMBERSHIP',
      teamId: team.id,
      requestedTeamRole: 'MEMBER',
      reason: 'Short on-call cover for overlap',
      durationMinutes: 60,
    });
    await decideAccessRequest(approver(owner.id, false), join.id, { approve: true });
    const promote = await createAccessRequest(user.id, {
      kind: 'TEAM_ROLE',
      teamId: team.id,
      requestedTeamRole: 'ADMIN',
      reason: 'Need to add a teammate during cover',
      durationMinutes: 480,
    });
    await decideAccessRequest(approver(owner.id, false), promote.id, { approve: true });
    const [first, second] = await db.accessGrant.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(second).toMatchObject({ previousTeamRole: null, createdMembership: true });

    await db.accessGrant.update({
      where: { id: first.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await processEndedAccessGrants();
    expect(
      await db.teamMember.findUnique({
        where: { userId_teamId: { userId: user.id, teamId: team.id } },
      })
    ).toMatchObject({ role: 'ADMIN' });

    await db.accessGrant.update({
      where: { id: second.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await processEndedAccessGrants();
    expect(
      await db.teamMember.findUnique({
        where: { userId_teamId: { userId: user.id, teamId: team.id } },
      })
    ).toBeNull();
  });

  it('changes custom roles without signing people out', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const holder = await createTestUser();
    const role = await saveCustomRole(admin.id, {
      name: 'Runner',
      capabilities: ['runbook.execute'],
    });
    const before = (await db.user.findUniqueOrThrow({ where: { id: holder.id } })).tokenVersion;
    await assignCustomRole(admin.id, holder.id, role.id);
    await saveCustomRole(admin.id, {
      id: role.id,
      name: 'Runner',
      capabilities: ['runbook.read.all'],
    });
    await archiveCustomRole(admin.id, role.id);
    expect((await db.user.findUniqueOrThrow({ where: { id: holder.id } })).tokenVersion).toBe(
      before
    );
  });

  it('lets a sole admin certify their own access, records what was not applied, and cancels', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const sso = await createTestUser({ role: 'RESPONDER', roleSource: 'OIDC' });
    const review = await startAccessReview(admin.id, { name: 'Solo review' });
    const items = await db.accessReviewItem.findMany({ where: { reviewId: review.id } });
    await decideAccessReviewItem(
      admin.id,
      items.find(item => item.userId === admin.id)!.id,
      'KEEP'
    );
    await decideAccessReviewItem(
      admin.id,
      items.find(item => item.userId === sso.id)!.id,
      'REVOKE'
    );
    const result = await completeAccessReview(admin.id, review.id);
    expect(result).toMatchObject({ revoked: 0, notApplied: 1 });
    const ssoItem = await db.accessReviewItem.findFirstOrThrow({
      where: { reviewId: review.id, userId: sso.id },
    });
    expect(ssoItem.appliedAt).toBeNull();
    expect(ssoItem.note).toContain('identity provider');
    const ownItem = await db.accessReviewItem.findFirstOrThrow({
      where: { reviewId: review.id, userId: admin.id },
    });
    expect(ownItem.note).toContain('Self-certified');

    const next = await startAccessReview(admin.id, { name: 'To cancel' });
    await cancelAccessReview(admin.id, next.id);
    expect((await db.accessReview.findUniqueOrThrow({ where: { id: next.id } })).status).toBe(
      'CANCELLED'
    );
  });
});
