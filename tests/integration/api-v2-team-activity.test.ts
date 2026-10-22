import { beforeEach, expect, it } from 'vitest';
import { GET as activity } from '@/app/api/v2/teams/[id]/activity/route';
import { logAudit } from '@/lib/audit';
import { listTeamActivity } from '@/lib/teams/activity';
import { setTeamMembership } from '@/lib/teams/administration';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import { createTestUser, resetDatabase, testPrisma as db } from '../helpers/test-db';
beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
});
async function fixture() {
  const admin = await createV2Credential(['teams:read', 'teams:write']);
  const owner = await createV2Credential(['teams:read'], 'USER');
  const team = await db.team.create({
    data: {
      name: 'Activity fixture',
      members: { create: { userId: owner.user.id, role: 'OWNER' } },
    },
  });
  return { admin, owner, team };
}
it('UI and REST share the same safe event projection and keep audit credentials/contact metadata private', async () => {
  const { owner, admin, team } = await fixture();
  const target = await createTestUser();
  await setTeamMembership(team.id, target.id, { role: 'MEMBER' }, admin.user);
  await logAudit({
    action: 'team.updated',
    entityType: 'TEAM',
    entityId: team.id,
    actorId: admin.user.id,
    details: {
      name: 'Reviewed safe name',
      password: 'hidden-audit-credential',
      providerToken: 'hidden-provider-value',
      internal: 'unreviewed-metadata',
    },
  });
  const response = await invokeV2(activity, owner.token, 'GET', `/teams/${team.id}/activity`, {
    id: team.id,
  });
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const body = await response.json();
  expect(body.data).toHaveLength(2);
  const serialized = JSON.stringify(body.data);
  for (const hidden of [
    'hidden-audit-credential',
    'hidden-provider-value',
    'unreviewed-metadata',
    admin.user.email,
    'actorEmail',
    'apiClientId',
  ])
    expect(serialized).not.toContain(hidden);
  expect(body.data[0].details).toEqual({ name: 'Reviewed safe name' });
  const ui = await db.$transaction(
    tx => listTeamActivity(tx, team.id, owner.user, { limit: 20, cursor: null }),
    { isolationLevel: 'Serializable' }
  );
  expect(JSON.parse(JSON.stringify(ui.data))).toEqual(body.data);
});
it('ordinary members, unrelated owners and read-only auditors cannot inspect administrative activity', async () => {
  const { team } = await fixture();
  for (const role of ['USER', 'RESPONDER', 'AUDITOR'] as const) {
    const caller = await createV2Credential(['teams:read'], role);
    await db.teamMember.create({
      data: {
        teamId: team.id,
        userId: caller.user.id,
        role: role === 'AUDITOR' ? 'OWNER' : 'MEMBER',
      },
    });
    expect(
      (await invokeV2(activity, caller.token, 'GET', `/teams/${team.id}/activity`, { id: team.id }))
        .status
    ).toBe(403);
  }
  const outsider = await createV2Credential(['teams:read'], 'USER');
  expect(
    (await invokeV2(activity, outsider.token, 'GET', `/teams/${team.id}/activity`, { id: team.id }))
      .status
  ).toBe(403);
});
it('isolates team and membership events with deterministic cursor pagination', async () => {
  const { owner, admin, team } = await fixture();
  const other = await db.team.create({ data: { name: 'Foreign activity fixture' } });
  const timestamp = new Date('2026-10-19T00:00:00Z');
  for (const [id, entityType, entityId] of [
    ['activity-a', 'TEAM', team.id],
    ['activity-b', 'TEAM_MEMBER', `${team.id}:member`],
    ['activity-foreign', 'TEAM', other.id],
    ['activity-impostor', 'SERVICE', team.id],
    ['activity-prefix', 'TEAM_MEMBER', `${team.id}extra:member`],
  ] as const)
    await db.auditLog.create({
      data: { id, entityType, entityId, action: 'fixture', createdAt: timestamp },
    });
  const first = await invokeV2(activity, owner.token, 'GET', `/teams/${team.id}/activity?limit=1`, {
    id: team.id,
  });
  const body = await first.json();
  expect(body.data.map((row: { id: string }) => row.id)).toEqual(['activity-b']);
  expect(body.pagination.hasMore).toBe(true);
  const second = await invokeV2(
    activity,
    owner.token,
    'GET',
    `/teams/${team.id}/activity?limit=1&cursor=${body.pagination.nextCursor}`,
    { id: team.id }
  );
  const next = await second.json();
  expect(next.data.map((row: { id: string }) => row.id)).toEqual(['activity-a']);
  expect(next.pagination.hasMore).toBe(false);
  expect(
    (
      await invokeV2(
        activity,
        admin.token,
        'GET',
        `/teams/${other.id}/activity?cursor=${body.pagination.nextCursor}`,
        { id: other.id }
      )
    ).status
  ).toBe(400);
});
it('reads SCIM-managed team history without permitting manual membership writes', async () => {
  const { admin, team } = await fixture();
  await db.team.update({ where: { id: team.id }, data: { scimExternalId: 'managed-history' } });
  expect(
    (await invokeV2(activity, admin.token, 'GET', `/teams/${team.id}/activity`, { id: team.id }))
      .status
  ).toBe(200);
});
