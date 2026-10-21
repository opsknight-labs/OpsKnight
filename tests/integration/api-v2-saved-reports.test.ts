import { beforeEach, expect, it } from 'vitest';
import { GET as list, POST as create } from '@/app/api/v2/reports/saved/route';
import { GET as read, PATCH as update, DELETE as remove } from '@/app/api/v2/reports/saved/[id]/route';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import { resetDatabase, testPrisma as db } from '../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) {
    throw new Error('Dedicated test DB required');
  }
  await resetDatabase();
});

it('saves and revises a bounded report with replay, stale-write and audit protection', async () => {
  const owner = await createV2Credential(['reports:read', 'reports:write'], 'USER');
  const path = '/reports/saved';
  const payload = { name: 'Weekly operations', metrics: ['totalIncidents', 'mtta'], windowDays: 7 };
  const created = await invokeV2(create, owner.token, 'POST', path, {}, payload,
    { 'Idempotency-Key': 'save-weekly' });
  expect(created.status, await created.clone().text()).toBe(201);
  const report = (await created.json()).data;
  expect((await invokeV2(create, owner.token, 'POST', path, {}, payload,
    { 'Idempotency-Key': 'save-weekly' })).headers.get('idempotency-replayed')).toBe('true');
  expect(await db.savedReport.count()).toBe(1);
  const listing = await invokeV2(list, owner.token, 'GET', path, {});
  expect((await listing.json()).data).toMatchObject([{ id: report.id }]);
  const itemPath = `${path}/${report.id}`;
  const before = await invokeV2(read, owner.token, 'GET', itemPath, { id: report.id });
  const tag = before.headers.get('etag')!;
  const changed = await invokeV2(update, owner.token, 'PATCH', itemPath, { id: report.id },
    { windowDays: 30 }, { 'If-Match': tag, 'Idempotency-Key': 'change-window' });
  expect(changed.status).toBe(200);
  expect(changed.headers.get('etag')).not.toBe(tag);
  expect((await invokeV2(update, owner.token, 'PATCH', itemPath, { id: report.id },
    { windowDays: 15 }, { 'If-Match': tag, 'Idempotency-Key': 'stale-window' })).status).toBe(412);
  expect((await invokeV2(remove, owner.token, 'DELETE', itemPath, { id: report.id }, undefined,
    { 'If-Match': changed.headers.get('etag')!, 'Idempotency-Key': 'delete-weekly' })).status).toBe(204);
  expect(await db.savedReport.count()).toBe(0);
  expect(await db.auditLog.count({ where: { entityType: 'SAVED_REPORT' } })).toBe(3);
});

it('isolates private and team reports and refuses sharing after membership revocation', async () => {
  const owner = await createV2Credential(['reports:read', 'reports:write'], 'USER');
  const outsider = await createV2Credential(['reports:read', 'reports:write'], 'USER');
  const team = await db.team.create({
    data: { name: 'Reports team', members: { create: { userId: owner.user.id } } },
  });
  const path = '/reports/saved';
  const created = await invokeV2(create, owner.token, 'POST', path, {}, {
    name: 'Shared', metrics: ['totalIncidents'], visibility: 'TEAM', teamId: team.id,
  }, { 'Idempotency-Key': 'team-report' });
  expect(created.status).toBe(201);
  const reportId = (await created.json()).data.id;
  expect((await invokeV2(read, outsider.token, 'GET', `${path}/${reportId}`,
    { id: reportId })).status).toBe(404);
  expect((await invokeV2(create, outsider.token, 'POST', path, {}, {
    name: 'Wrong team', metrics: ['totalIncidents'], visibility: 'TEAM', teamId: team.id,
  }, { 'Idempotency-Key': 'wrong-team' })).status).toBe(403);
  const member = await createV2Credential(['reports:read', 'reports:write'], 'USER');
  await db.teamMember.create({ data: { userId: member.user.id, teamId: team.id } });
  expect((await invokeV2(read, member.token, 'GET', `${path}/${reportId}`,
    { id: reportId })).status).toBe(200);
  await db.teamMember.delete({ where: { userId_teamId: { userId: member.user.id, teamId: team.id } } });
  expect((await invokeV2(read, member.token, 'GET', `${path}/${reportId}`,
    { id: reportId })).status).toBe(404);
});
