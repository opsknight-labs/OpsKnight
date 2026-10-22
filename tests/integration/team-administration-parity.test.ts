import { beforeEach, expect, it, vi } from 'vitest';
const identity = vi.hoisted(() => ({ id: '' }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/rbac', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/rbac')>()),
  assertAdminOrTeamOwner: async () => ({ id: identity.id, role: 'ADMIN' }),
  assertAdmin: async () => ({ id: identity.id, role: 'ADMIN' }),
}));
import {
  addTeamMember,
  updateTeamMemberRole,
  updateTeamMemberNotifications,
  removeTeamMember,
  designateTeamLead,
} from '@/app/(app)/teams/actions';
import { addUserToTeam, removeUserFromTeam } from '@/app/(app)/users/actions';
import { PUT as putMember } from '@/app/api/v2/teams/[id]/members/[userId]/route';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import { createTestUser, resetDatabase, testPrisma as db } from '../helpers/test-db';
beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
});
function form(data: Record<string, string>) {
  const out = new FormData();
  for (const [key, value] of Object.entries(data)) out.set(key, value);
  return out;
}
it('UI and REST membership changes commit the same policy state, audit and notification outcomes', async () => {
  const admin = await createV2Credential(['teams:write']);
  identity.id = admin.user.id;
  const team = await db.team.create({ data: { name: 'UI REST parity' } });
  const ui = await createTestUser(),
    api = await createTestUser();
  expect(await addTeamMember(team.id, form({ userId: ui.id, role: 'ADMIN' }))).toBeUndefined();
  const current = await db.team.findUniqueOrThrow({ where: { id: team.id } });
  const response = await invokeV2(
    putMember,
    admin.token,
    'PUT',
    `/teams/${team.id}/members/${api.id}`,
    { id: team.id, userId: api.id },
    { role: 'ADMIN' },
    { 'If-Match': `"${current.revision}"`, 'Idempotency-Key': 'parity-api' }
  );
  expect(response.status).toBe(200);
  for (const user of [ui, api]) {
    expect(
      await db.teamMember.findUnique({
        where: { userId_teamId: { userId: user.id, teamId: team.id } },
      })
    ).toMatchObject({ role: 'ADMIN', receiveTeamNotifications: true });
    expect(
      await db.inAppNotification.count({ where: { userId: user.id, entityId: team.id } })
    ).toBe(1);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).tokenVersion).toBe(
      user.tokenVersion + 1
    );
    expect(
      await db.auditLog.count({
        where: { action: 'team.member.added', entityId: `${team.id}:${user.id}` },
      })
    ).toBe(1);
  }
});
it('the actual UI role, notification, lead and removal actions use one canonical command audit each', async () => {
  const admin = await createV2Credential([]);
  identity.id = admin.user.id;
  const team = await db.team.create({ data: { name: 'UI membership lifecycle' } });
  const target = await createTestUser();
  await addTeamMember(team.id, form({ userId: admin.user.id, role: 'OWNER' }));
  await addUserToTeam(target.id, form({ teamId: team.id, role: 'MEMBER' }));
  const member = await db.teamMember.findUniqueOrThrow({
    where: { userId_teamId: { userId: target.id, teamId: team.id } },
  });
  expect(await updateTeamMemberRole(member.id, form({ role: 'ADMIN' }))).toBeUndefined();
  expect(await updateTeamMemberNotifications(member.id, false)).toBeUndefined();
  expect(await designateTeamLead(team.id, target.id)).toEqual({ success: true });
  await removeUserFromTeam(member.id);
  expect(await db.teamMember.findUnique({ where: { id: member.id } })).toBeNull();
  expect((await db.team.findUniqueOrThrow({ where: { id: team.id } })).teamLeadId).toBeNull();
  for (const action of [
    'team.member.role.updated',
    'team.member.notifications.updated',
    'team.member.removed',
    'team.lead_updated',
  ])
    expect(await db.auditLog.count({ where: { action } })).toBe(1);
  expect(
    await removeTeamMember(
      (await db.teamMember.findFirstOrThrow({ where: { teamId: team.id } })).id
    )
  ).toHaveProperty('error');
});
it('rechecks authorization within the command despite an earlier UI guard decision', async () => {
  const formerOwner = await createTestUser({ role: 'USER' });
  identity.id = formerOwner.id;
  const team = await db.team.create({ data: { name: 'Revoked UI owner' } });
  await db.teamMember.create({ data: { teamId: team.id, userId: formerOwner.id, role: 'MEMBER' } });
  const target = await createTestUser();
  expect(await addTeamMember(team.id, form({ userId: target.id, role: 'MEMBER' }))).toHaveProperty(
    'error'
  );
  expect(await db.teamMember.count({ where: { userId: target.id } })).toBe(0);
  expect(await db.auditLog.count()).toBe(0);
});
