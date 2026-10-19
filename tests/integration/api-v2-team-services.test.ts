import { beforeEach, expect, it, vi } from 'vitest';
const identity = vi.hoisted(() => ({ id: '' }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/rbac', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/rbac')>()),
  assertAdminOrTeamOwner: async () => ({ id: identity.id, role: 'ADMIN' }),
}));
import { assignServicesToTeam } from '@/app/(app)/teams/actions';
import { assignTeamServices } from '@/lib/teams/service-commands';
import { PUT as assign } from '@/app/api/v2/teams/[id]/services/[serviceId]/route';
import { GET as list } from '@/app/api/v2/teams/[id]/services/route';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import { resetDatabase, testPrisma as db } from '../helpers/test-db';
beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
});
async function fixture() {
  const admin = await createV2Credential(['teams:read', 'teams:write']);
  const owner = await createV2Credential(['teams:read', 'teams:write'], 'USER');
  const team = await db.team.create({
    data: { name: 'Destination', members: { create: { userId: owner.user.id, role: 'OWNER' } } },
  });
  const service = await db.service.create({ data: { name: 'Managed service' } });
  return { admin, owner, team, service };
}
const send = (token: string, teamId: string, serviceId: string, revision: number, key: string) =>
  invokeV2(
    assign,
    token,
    'PUT',
    `/teams/${teamId}/services/${serviceId}`,
    { id: teamId, serviceId },
    {},
    { 'If-Match': `"${revision}"`, 'Idempotency-Key': key }
  );
it('concurrent same-key assignment writes once and preserves canonical audit attribution', async () => {
  const { owner, team, service } = await fixture();
  const responses = await Promise.all(
    [1, 2, 3].map(() => send(owner.token, team.id, service.id, service.revision, 'claim'))
  );
  expect(responses.map(response => response.status)).toEqual([200, 200, 200]);
  const current = await db.service.findUniqueOrThrow({ where: { id: service.id } });
  expect(current).toMatchObject({ teamId: team.id, revision: service.revision + 1 });
  const audits = await db.auditLog.findMany({ where: { action: 'team.services_assigned' } });
  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({
    entityId: team.id,
    actorId: owner.user.id,
    details: expect.objectContaining({
      source: 'API',
      metadata: expect.objectContaining({ apiClientId: owner.key.id }),
    }),
  });
});
it('only an administrator can move a service from another team', async () => {
  const { owner, admin, team, service } = await fixture();
  const other = await db.team.create({ data: { name: 'Existing owner' } });
  const assigned = await db.service.update({
    where: { id: service.id },
    data: { teamId: other.id },
  });
  expect((await send(owner.token, team.id, service.id, assigned.revision, 'steal')).status).toBe(
    403
  );
  await expect(
    assignTeamServices(team.id, { serviceIds: [service.id] }, owner.user)
  ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
  expect((await send(admin.token, team.id, service.id, assigned.revision, 'move')).status).toBe(
    200
  );
});
it('conflicting owners cannot both claim an unassigned service', async () => {
  const { owner, team, service } = await fixture();
  const second = await createV2Credential(['teams:write'], 'USER');
  const other = await db.team.create({
    data: {
      name: 'Concurrent destination',
      members: { create: { userId: second.user.id, role: 'OWNER' } },
    },
  });
  const responses = await Promise.all([
    send(owner.token, team.id, service.id, service.revision, 'first'),
    send(second.token, other.id, service.id, service.revision, 'second'),
  ]);
  expect(responses.filter(response => response.status === 200)).toHaveLength(1);
  expect(responses.filter(response => [403, 412].includes(response.status))).toHaveLength(1);
  expect(await db.auditLog.count({ where: { action: 'team.services_assigned' } })).toBe(1);
  expect([team.id, other.id]).toContain(
    (await db.service.findUniqueOrThrow({ where: { id: service.id } })).teamId
  );
});
it('no-op assignments preserve revisions; stale Service revisions and wildcard preconditions are rejected', async () => {
  const { owner, team, service } = await fixture();
  const first = await send(owner.token, team.id, service.id, service.revision, 'first');
  expect(first.status).toBe(200);
  const body = (await first.json()).data;
  const noOp = await send(owner.token, team.id, service.id, body.revision, 'no-op');
  expect(noOp.status).toBe(200);
  expect(noOp.headers.get('etag')).toBe(first.headers.get('etag'));
  expect((await send(owner.token, team.id, service.id, service.revision, 'stale')).status).toBe(
    412
  );
  expect(
    (
      await invokeV2(
        assign,
        owner.token,
        'PUT',
        `/teams/${team.id}/services/${service.id}`,
        { id: team.id, serviceId: service.id },
        {},
        { 'If-Match': '*', 'Idempotency-Key': 'wildcard' }
      )
    ).status
  ).toBe(400);
  expect(await db.auditLog.count()).toBe(1);
});
it('replay fails after a service moves outside the team owner authority', async () => {
  const { owner, team, service } = await fixture();
  expect((await send(owner.token, team.id, service.id, service.revision, 'original')).status).toBe(
    200
  );
  const other = await db.team.create({ data: { name: 'Moved destination' } });
  await db.service.update({ where: { id: service.id }, data: { teamId: other.id } });
  expect((await send(owner.token, team.id, service.id, service.revision, 'original')).status).toBe(
    403
  );
});
it('UI bulk assignment is atomic, bounded and uses the same canonical service command', async () => {
  const { owner, team, service } = await fixture();
  identity.id = owner.user.id;
  const second = await db.service.create({ data: { name: 'Second service' } });
  expect(await assignServicesToTeam(team.id, [service.id, second.id])).toEqual({ success: true });
  expect(await db.service.count({ where: { teamId: team.id } })).toBe(2);
  expect(await db.auditLog.count({ where: { action: 'team.services_assigned' } })).toBe(1);
  const unassigned = await db.service.create({ data: { name: 'Rollback service' } });
  const other = await db.team.create({ data: { name: 'Foreign team' } });
  const foreign = await db.service.create({ data: { name: 'Foreign service', teamId: other.id } });
  expect(await assignServicesToTeam(team.id, [unassigned.id, foreign.id])).toHaveProperty('error');
  expect((await db.service.findUniqueOrThrow({ where: { id: unassigned.id } })).teamId).toBeNull();
  await expect(
    assignTeamServices(team.id, { serviceIds: Array(101).fill(service.id) }, owner.user)
  ).rejects.toThrow();
});
it('service lists are bounded, team-authorized and reject another team cursor', async () => {
  const { owner, admin, team, service } = await fixture();
  const second = await db.service.create({ data: { name: 'Second page' } });
  await assignTeamServices(team.id, { serviceIds: [service.id, second.id] }, owner.user);
  const response = await invokeV2(list, owner.token, 'GET', `/teams/${team.id}/services?limit=1`, {
    id: team.id,
  });
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const body = await response.json();
  expect(body.data).toHaveLength(1);
  expect(body.pagination.hasMore).toBe(true);
  const other = await db.team.create({ data: { name: 'Unrelated pagination' } });
  expect(
    (await invokeV2(list, owner.token, 'GET', `/teams/${other.id}/services`, { id: other.id }))
      .status
  ).toBe(403);
  expect(
    (
      await invokeV2(
        list,
        admin.token,
        'GET',
        `/teams/${other.id}/services?cursor=${body.pagination.nextCursor}`,
        { id: other.id }
      )
    ).status
  ).toBe(400);
});
it('assignment rolls back with an outer transaction', async () => {
  const { owner, team, service } = await fixture();
  await expect(
    db.$transaction(
      async tx => {
        await assignTeamServices(team.id, { serviceIds: [service.id] }, owner.user, { client: tx });
        throw new Error('rollback');
      },
      { isolationLevel: 'Serializable' }
    )
  ).rejects.toThrow('rollback');
  expect((await db.service.findUniqueOrThrow({ where: { id: service.id } })).teamId).toBeNull();
  expect(await db.auditLog.count()).toBe(0);
});
