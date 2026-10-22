import { beforeEach, expect, it } from 'vitest';
import { GET as listMembers } from '@/app/api/v2/teams/[id]/members/route';
import {
  PUT as putMember,
  DELETE as removeMember,
} from '@/app/api/v2/teams/[id]/members/[userId]/route';
import { GET as getLead, PUT as putLead } from '@/app/api/v2/teams/[id]/lead/route';
import { setTeamMembership, deleteTeamMembership } from '@/lib/teams/administration';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import { createTestUser, testPrisma as db, resetDatabase } from '../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
});
async function fixture() {
  const admin = await createV2Credential(['teams:read', 'teams:write']);
  const owner = await createV2Credential(['teams:read', 'teams:write'], 'USER');
  const team = await db.team.create({ data: { name: 'Identity administration fixture' } });
  await db.teamMember.create({ data: { teamId: team.id, userId: owner.user.id, role: 'OWNER' } });
  const target = await createTestUser();
  return {
    admin,
    owner,
    team: await db.team.findUniqueOrThrow({ where: { id: team.id } }),
    target,
  };
}
const headers = (revision: number, key: string) => ({
  'If-Match': `"${revision}"`,
  'Idempotency-Key': key,
});
function put(
  token: string,
  teamId: string,
  userId: string,
  revision: number,
  key: string,
  body: unknown = { role: 'MEMBER' }
) {
  return invokeV2(
    putMember,
    token,
    'PUT',
    `/teams/${teamId}/members/${userId}`,
    { id: teamId, userId },
    body,
    headers(revision, key)
  );
}
it('commits membership, session revocation, notification, audit and concurrent same-key receipts once', async () => {
  const { owner, team, target } = await fixture();
  const responses = await Promise.all(
    [1, 2, 3].map(() => put(owner.token, team.id, target.id, team.revision, 'add-once'))
  );
  expect(responses.map(r => r.status)).toEqual([200, 200, 200]);
  expect(
    new Set(await Promise.all(responses.map(async r => (await r.json()).data.membership.id))).size
  ).toBe(1);
  expect(await db.teamMember.count({ where: { teamId: team.id, userId: target.id } })).toBe(1);
  expect((await db.user.findUniqueOrThrow({ where: { id: target.id } })).tokenVersion).toBe(
    target.tokenVersion + 1
  );
  expect(
    await db.inAppNotification.count({ where: { userId: target.id, entityId: team.id } })
  ).toBe(1);
  const audits = await db.auditLog.findMany({ where: { action: 'team.member.added' } });
  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({
    actorId: owner.user.id,
    details: expect.objectContaining({
      source: 'API',
      metadata: expect.objectContaining({ apiClientId: owner.key.id }),
    }),
  });
});
it('requires current ownership rather than team membership or credential scope alone', async () => {
  const { team, target } = await fixture();
  for (const role of ['USER', 'RESPONDER', 'AUDITOR'] as const) {
    const member = await createV2Credential(['teams:read', 'teams:write'], role);
    await db.teamMember.create({
      data: {
        teamId: team.id,
        userId: member.user.id,
        role: role === 'AUDITOR' ? 'OWNER' : 'ADMIN',
      },
    });
    const current = await db.team.findUniqueOrThrow({ where: { id: team.id } });
    expect(
      (await put(member.token, team.id, target.id, current.revision, `denied-${role}`)).status
    ).toBe(403);
  }
  expect(await db.teamMember.count({ where: { userId: target.id } })).toBe(0);
});
it('requires scopes even for an organization administrator and rejects unrelated-team IDOR', async () => {
  const { owner, team, target } = await fixture();
  const reader = await createV2Credential(['teams:read']);
  expect((await put(reader.token, team.id, target.id, team.revision, 'no-write')).status).toBe(403);
  const other = await db.team.create({ data: { name: 'Unrelated team' } });
  expect((await put(owner.token, other.id, target.id, other.revision, 'cross-team')).status).toBe(
    403
  );
});
it('enforces concrete preconditions, strict schemas, stale revisions and key/body binding', async () => {
  const { owner, team, target } = await fixture();
  const invoke = (extra: Record<string, string>, body: unknown = { role: 'MEMBER' }) =>
    invokeV2(
      putMember,
      owner.token,
      'PUT',
      `/teams/${team.id}/members/${target.id}`,
      { id: team.id, userId: target.id },
      body,
      extra
    );
  expect((await invoke({ 'Idempotency-Key': 'missing-revision' })).status).toBe(428);
  expect((await invoke({ 'If-Match': '*', 'Idempotency-Key': 'wildcard' })).status).toBe(400);
  expect((await invoke({ 'If-Match': `"${team.revision}"` })).status).toBe(400);
  expect(
    (await invoke(headers(team.revision, 'unknown'), { role: 'MEMBER', isAdmin: true })).status
  ).toBe(400);
  expect((await invoke(headers(team.revision, 'first'))).status).toBe(200);
  expect((await invoke(headers(team.revision, 'stale'), { role: 'OWNER' })).status).toBe(412);
  expect((await invoke(headers(team.revision, 'first'), { role: 'OWNER' })).status).toBe(409);
});
it('rechecks current authority before replay after owner demotion', async () => {
  const { admin, owner, team, target } = await fixture();
  expect((await put(owner.token, team.id, target.id, team.revision, 'owner-write')).status).toBe(
    200
  );
  await setTeamMembership(team.id, admin.user.id, { role: 'OWNER' }, admin.user);
  await setTeamMembership(team.id, owner.user.id, { role: 'MEMBER' }, admin.user);
  expect((await put(owner.token, team.id, target.id, team.revision, 'owner-write')).status).toBe(
    403
  );
});
it('preserves one active owner during concurrent UI-command demotions', async () => {
  const { admin, owner, team } = await fixture();
  await setTeamMembership(team.id, admin.user.id, { role: 'OWNER' }, admin.user);
  const results = await Promise.allSettled(
    [owner.user.id, admin.user.id].map(id =>
      setTeamMembership(team.id, id, { role: 'MEMBER' }, admin.user)
    )
  );
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(
    await db.teamMember.count({
      where: { teamId: team.id, role: 'OWNER', user: { status: 'ACTIVE' } },
    })
  ).toBe(1);
});
it('does not count disabled owners and rejects assigning inactive members', async () => {
  const { admin, owner, team, target } = await fixture();
  await db.user.update({ where: { id: target.id }, data: { status: 'DISABLED' } });
  await db.teamMember.create({ data: { teamId: team.id, userId: target.id, role: 'OWNER' } });
  await expect(deleteTeamMembership(team.id, owner.user.id, admin.user)).rejects.toMatchObject({
    code: 'RESOURCE_CONFLICT',
  });
  const current = await db.team.findUniqueOrThrow({ where: { id: team.id } });
  expect((await put(admin.token, team.id, target.id, current.revision, 'disabled')).status).toBe(
    409
  );
});
it('preserves local membership and lead authority for teams with legacy directory IDs', async () => {
  const { admin, team, target } = await fixture();
  const managed = await db.team.update({
    where: { id: team.id },
    data: { scimExternalId: 'managed-group' },
  });
  expect((await put(admin.token, team.id, target.id, managed.revision, 'scim')).status).toBe(200);
  await expect(
    setTeamMembership(team.id, target.id, { role: 'MEMBER' }, admin.user)
  ).resolves.toMatchObject({ teamId: team.id, userId: target.id });
  const latest = await db.team.findUniqueOrThrow({ where: { id: team.id } });
  expect(
    (
      await invokeV2(
        putLead,
        admin.token,
        'PUT',
        `/teams/${team.id}/lead`,
        { id: team.id },
        { userId: null },
        headers(latest.revision, 'scim-lead')
      )
    ).status
  ).toBe(200);
});
it('changes only notifications without resetting roles or revoking unchanged sessions', async () => {
  const { admin, team, target } = await fixture();
  const first = await setTeamMembership(team.id, target.id, { role: 'ADMIN' }, admin.user);
  const before = await db.user.findUniqueOrThrow({ where: { id: target.id } });
  const changed = await put(admin.token, team.id, target.id, first.revision, 'notifications', {
    role: 'ADMIN',
    receiveTeamNotifications: false,
  });
  expect(changed.status).toBe(200);
  expect((await changed.json()).data.membership).toMatchObject({
    role: 'ADMIN',
    receiveTeamNotifications: false,
  });
  expect((await db.user.findUniqueOrThrow({ where: { id: target.id } })).tokenVersion).toBe(
    before.tokenVersion
  );
});
it('no-op membership and lead writes preserve revisions and do not add audits', async () => {
  const { admin, owner, team } = await fixture();
  const response = await put(admin.token, team.id, owner.user.id, team.revision, 'noop', {
    role: 'OWNER',
  });
  expect(response.status).toBe(200);
  expect(response.headers.get('etag')).toBe(`"${team.revision}"`);
  expect(await db.auditLog.count()).toBe(0);
  expect(
    (
      await invokeV2(
        putLead,
        admin.token,
        'PUT',
        `/teams/${team.id}/lead`,
        { id: team.id },
        { userId: null },
        headers(team.revision, 'noop-lead')
      )
    ).status
  ).toBe(200);
  expect(await db.auditLog.count()).toBe(0);
});
it('lead must be an active member; removal clears the lead and invalidates the parent revision', async () => {
  const { admin, team, target } = await fixture();
  const lead = (userId: string | null, revision: number, key: string) =>
    invokeV2(
      putLead,
      admin.token,
      'PUT',
      `/teams/${team.id}/lead`,
      { id: team.id },
      { userId },
      headers(revision, key)
    );
  expect((await lead(target.id, team.revision, 'not-member')).status).toBe(409);
  const added = await setTeamMembership(team.id, target.id, { role: 'MEMBER' }, admin.user);
  const designated = await lead(target.id, added.revision, 'lead');
  expect(designated.status).toBe(200);
  const current = (await designated.json()).data;
  const removed = await invokeV2(
    removeMember,
    admin.token,
    'DELETE',
    `/teams/${team.id}/members/${target.id}`,
    { id: team.id, userId: target.id },
    undefined,
    headers(current.revision, 'remove')
  );
  expect(removed.status).toBe(200);
  const read = await invokeV2(getLead, admin.token, 'GET', `/teams/${team.id}/lead`, {
    id: team.id,
  });
  expect((await read.json()).data.teamLeadId).toBeNull();
  expect(Number(read.headers.get('etag')!.replaceAll('"', ''))).toBeGreaterThan(current.revision);
  expect(await db.auditLog.count({ where: { action: 'team.member.removed' } })).toBe(1);
});
it('uses bounded team-bound cursors and excludes credential/user profile data', async () => {
  const { admin, owner, team, target } = await fixture();
  await setTeamMembership(team.id, target.id, { role: 'MEMBER' }, admin.user);
  const path = `/teams/${team.id}/members`;
  const first = await invokeV2(listMembers, owner.token, 'GET', `${path}?limit=1`, { id: team.id });
  expect(first.status).toBe(200);
  expect(first.headers.get('cache-control')).toBe('no-store');
  const body = await first.json();
  expect(body.data).toHaveLength(1);
  expect(body.pagination.hasMore).toBe(true);
  expect(JSON.stringify(body.data)).not.toMatch(/email|password|tokenVersion/);
  const next = await invokeV2(
    listMembers,
    owner.token,
    'GET',
    `${path}?limit=1&cursor=${body.pagination.nextCursor}`,
    { id: team.id }
  );
  expect(next.status).toBe(200);
  expect((await next.json()).data[0].id).not.toBe(body.data[0].id);
  const other = await db.team.create({ data: { name: 'Other paginated team' } });
  const cross = await invokeV2(
    listMembers,
    admin.token,
    'GET',
    `/teams/${other.id}/members?cursor=${body.pagination.nextCursor}`,
    { id: other.id }
  );
  expect(cross.status).toBe(400);
  const outsider = await createV2Credential(['teams:read'], 'USER');
  expect((await invokeV2(listMembers, outsider.token, 'GET', path, { id: team.id })).status).toBe(
    403
  );
});
it('direct older/SCIM membership writes also invalidate REST parent revisions', async () => {
  const { admin, team, target } = await fixture();
  const added = await db.teamMember.create({ data: { teamId: team.id, userId: target.id } });
  const first = await db.team.findUniqueOrThrow({ where: { id: team.id } });
  expect(first.revision).toBeGreaterThan(team.revision);
  await db.teamMember.update({
    where: { id: added.id },
    data: { receiveTeamNotifications: false },
  });
  const second = await db.team.findUniqueOrThrow({ where: { id: team.id } });
  expect(second.revision).toBeGreaterThan(first.revision);
  expect((await put(admin.token, team.id, target.id, first.revision, 'old-writer')).status).toBe(
    412
  );
  await db.teamMember.delete({ where: { id: added.id } });
  expect((await db.team.findUniqueOrThrow({ where: { id: team.id } })).revision).toBeGreaterThan(
    second.revision
  );
});
it('rolls back membership, audit, notification and token version with the outer transaction', async () => {
  const { admin, team, target } = await fixture();
  await expect(
    db.$transaction(
      async tx => {
        await setTeamMembership(team.id, target.id, { role: 'MEMBER' }, admin.user, { client: tx });
        throw new Error('intentional rollback');
      },
      { isolationLevel: 'Serializable' }
    )
  ).rejects.toThrow('intentional rollback');
  expect(await db.teamMember.count({ where: { userId: target.id } })).toBe(0);
  expect(await db.auditLog.count()).toBe(0);
  expect(await db.inAppNotification.count()).toBe(0);
  expect((await db.user.findUniqueOrThrow({ where: { id: target.id } })).tokenVersion).toBe(
    target.tokenVersion
  );
  expect((await db.team.findUniqueOrThrow({ where: { id: team.id } })).revision).toBe(
    team.revision
  );
});
