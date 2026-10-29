import { beforeEach, expect, it } from 'vitest';
import { GET as list, POST as create } from '@/app/api/v2/dashboards/route';
import { GET as read, PATCH as update, DELETE as remove } from '@/app/api/v2/dashboards/[id]/route';
import { GET as data } from '@/app/api/v2/dashboards/[id]/data/route';
import { GET as downloadData } from '@/app/api/v2/dashboards/[id]/export/route';
import { createHash } from 'node:crypto';
import { POST as duplicate } from '@/app/api/v2/dashboards/[id]/duplicate/route';
import {
  GET as listWidgets,
  PUT as replaceWidgets,
} from '@/app/api/v2/dashboards/[id]/widgets/route';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import { resetDatabase, testPrisma as db } from '../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) {
    throw new Error('Dedicated test DB required');
  }
  await resetDatabase();
});

it('creates, lists, updates and deletes an owned dashboard with revision and audit fencing', async () => {
  const owner = await createV2Credential(['reports:read', 'reports:write'], 'USER');
  const path = '/dashboards';
  for (const widget of [
    { widgetType: 'custom', metricKey: 'totalIncidents' },
    { widgetType: 'metric', metricKey: 'privateMetric' },
    { widgetType: 'metric', metricKey: 'totalIncidents', widgetDefinitionId: 'mttr' },
  ]) {
    const invalid = await invokeV2(
      create,
      owner.token,
      'POST',
      path,
      {},
      {
        name: 'Unsupported',
        widgets: [widget],
      },
      {
        'Idempotency-Key': `invalid-${widget.widgetType}-${widget.metricKey}-${widget.widgetDefinitionId ?? 'none'}`,
      }
    );
    expect(invalid.status).toBe(400);
  }
  expect(await db.dashboard.count()).toBe(0);
  const created = await invokeV2(
    create,
    owner.token,
    'POST',
    path,
    {},
    {
      name: 'Operations',
      widgets: [{ widgetType: 'metric', metricKey: 'totalIncidents' }],
    },
    { 'Idempotency-Key': 'create-ops' }
  );
  expect(created.status, await created.clone().text()).toBe(201);
  const dashboard = (await created.json()).data;
  expect(dashboard.widgets).toHaveLength(1);
  const replay = await invokeV2(
    create,
    owner.token,
    'POST',
    path,
    {},
    {
      name: 'Operations',
      widgets: [{ widgetType: 'metric', metricKey: 'totalIncidents' }],
    },
    { 'Idempotency-Key': 'create-ops' }
  );
  expect(replay.status).toBe(201);
  expect(await db.dashboard.count()).toBe(1);

  const listing = await invokeV2(list, owner.token, 'GET', path, {});
  expect((await listing.json()).data).toMatchObject([{ id: dashboard.id, widgetCount: 1 }]);
  const itemPath = `${path}/${dashboard.id}`;
  const original = await invokeV2(read, owner.token, 'GET', itemPath, { id: dashboard.id });
  const tag = original.headers.get('etag')!;
  expect(tag).toBe('"1"');
  const changed = await invokeV2(
    update,
    owner.token,
    'PATCH',
    itemPath,
    { id: dashboard.id },
    {
      widgets: [{ widgetType: 'gauge', metricKey: 'ackCompliance' }],
    },
    { 'If-Match': tag, 'Idempotency-Key': 'replace-widgets' }
  );
  expect(changed.status).toBe(200);
  expect(changed.headers.get('etag')).not.toBe(tag);
  expect((await changed.json()).data.widgets).toMatchObject([{ widgetType: 'gauge' }]);
  const repeated = await invokeV2(
    update,
    owner.token,
    'PATCH',
    itemPath,
    { id: dashboard.id },
    {
      widgets: [{ widgetType: 'gauge', metricKey: 'ackCompliance' }],
    },
    { 'If-Match': tag, 'Idempotency-Key': 'replace-widgets' }
  );
  expect(repeated.status).toBe(200);
  expect(repeated.headers.get('idempotency-replayed')).toBe('true');
  expect(await db.dashboardWidget.count({ where: { dashboardId: dashboard.id } })).toBe(1);
  expect(
    (
      await invokeV2(
        update,
        owner.token,
        'PATCH',
        itemPath,
        { id: dashboard.id },
        {
          name: 'Stale',
        },
        { 'If-Match': tag, 'Idempotency-Key': 'stale' }
      )
    ).status
  ).toBe(412);
  expect(
    (
      await invokeV2(
        update,
        owner.token,
        'PATCH',
        itemPath,
        { id: dashboard.id },
        {
          name: 'Wildcard',
        },
        { 'If-Match': '*', 'Idempotency-Key': 'wildcard' }
      )
    ).status
  ).toBe(400);
  expect(
    (
      await invokeV2(remove, owner.token, 'DELETE', itemPath, { id: dashboard.id }, undefined, {
        'If-Match': changed.headers.get('etag')!,
        'Idempotency-Key': 'delete-ops',
      })
    ).status
  ).toBe(204);
  expect(await db.dashboard.count()).toBe(0);
  expect(await db.auditLog.count({ where: { entityType: 'DASHBOARD' } })).toBe(3);
});

it('allows one of two concurrent revision-bound updates and denies a read-only credential mutation', async () => {
  const owner = await createV2Credential(['reports:read', 'reports:write'], 'USER');
  const reader = await createV2Credential(['reports:read'], 'USER');
  const dashboard = await db.dashboard.create({
    data: { name: 'Original', userId: owner.user.id, layout: {} },
  });
  const path = `/dashboards/${dashboard.id}`;
  expect(
    (
      await invokeV2(
        update,
        reader.token,
        'PATCH',
        path,
        { id: dashboard.id },
        {
          name: 'Forbidden',
        },
        { 'If-Match': '"1"', 'Idempotency-Key': 'no-scope' }
      )
    ).status
  ).toBe(403);
  const attempts = await Promise.all(
    ['First', 'Second'].map(name =>
      invokeV2(
        update,
        owner.token,
        'PATCH',
        path,
        { id: dashboard.id },
        { name },
        {
          'If-Match': '"1"',
          'Idempotency-Key': `update-${name}`,
        }
      )
    )
  );
  expect(attempts.filter(response => response.status === 200)).toHaveLength(1);
  expect(attempts.filter(response => response.status === 412)).toHaveLength(1);
  expect((await db.dashboard.findUniqueOrThrow({ where: { id: dashboard.id } })).revision).toBe(2);
  expect(await db.auditLog.count({ where: { action: 'dashboard.updated' } })).toBe(1);
});

it('duplicates an accessible template and revision-fences explicit widget replacement', async () => {
  const owner = await createV2Credential(['reports:read', 'reports:write'], 'USER');
  const source = await db.dashboard.create({
    data: {
      name: 'Template',
      userId: owner.user.id,
      isTemplate: true,
      layout: { columns: 4 },
      widgets: {
        create: {
          widgetType: 'metric',
          metricKey: 'totalIncidents',
          position: { x: 0, y: 0, w: 1, h: 1 },
          config: {},
        },
      },
    },
  });
  const sourcePath = `/dashboards/${source.id}/duplicate`;
  const copied = await invokeV2(
    duplicate,
    owner.token,
    'POST',
    sourcePath,
    { id: source.id },
    {},
    {
      'Idempotency-Key': 'copy-template',
    }
  );
  expect(copied.status, await copied.clone().text()).toBe(201);
  const newId = (await copied.json()).data.id;
  expect(await db.dashboardWidget.count({ where: { dashboardId: newId } })).toBe(1);
  expect(
    (
      await invokeV2(
        duplicate,
        owner.token,
        'POST',
        sourcePath,
        { id: source.id },
        {},
        {
          'Idempotency-Key': 'copy-template',
        }
      )
    ).headers.get('idempotency-replayed')
  ).toBe('true');
  expect(await db.dashboard.count()).toBe(2);
  const widgetsPath = `/dashboards/${newId}/widgets`;
  const before = await invokeV2(listWidgets, owner.token, 'GET', widgetsPath, { id: newId });
  expect(before.status).toBe(200);
  expect((await before.json()).data.widgets).toHaveLength(1);
  const replacement = await invokeV2(
    replaceWidgets,
    owner.token,
    'PUT',
    widgetsPath,
    { id: newId },
    {
      widgets: [{ widgetType: 'gauge', metricKey: 'ackCompliance' }],
    },
    { 'If-Match': before.headers.get('etag')!, 'Idempotency-Key': 'replace-copy' }
  );
  expect(replacement.status, await replacement.clone().text()).toBe(200);
  expect(replacement.headers.get('etag')).not.toBe(before.headers.get('etag'));
  expect((await replacement.json()).data.widgets).toMatchObject([{ widgetType: 'gauge' }]);
  expect(
    (
      await invokeV2(
        replaceWidgets,
        owner.token,
        'PUT',
        widgetsPath,
        { id: newId },
        {
          widgets: [],
        },
        { 'If-Match': before.headers.get('etag')!, 'Idempotency-Key': 'stale-copy' }
      )
    ).status
  ).toBe(412);
  expect(await db.auditLog.count({ where: { entityType: 'DASHBOARD' } })).toBe(2);
});

it('isolates private dashboards and permits team sharing only for current members', async () => {
  const owner = await createV2Credential(
    ['reports:read', 'reports:write', 'incidents:read'],
    'USER'
  );
  const outsider = await createV2Credential(['reports:read', 'reports:write'], 'USER');
  const team = await db.team.create({
    data: { name: 'Response', members: { create: { userId: owner.user.id, role: 'MEMBER' } } },
  });
  const path = '/dashboards';
  const privateDashboard = await db.dashboard.create({
    data: { name: 'Private', userId: owner.user.id, layout: {} },
  });
  expect(
    (
      await invokeV2(read, outsider.token, 'GET', `${path}/${privateDashboard.id}`, {
        id: privateDashboard.id,
      })
    ).status
  ).toBe(404);
  expect((await invokeV2(list, outsider.token, 'GET', path, {})).status).toBe(200);
  const teamDashboard = await invokeV2(
    create,
    owner.token,
    'POST',
    path,
    {},
    {
      name: 'Shared',
      visibility: 'TEAM',
      teamId: team.id,
    },
    { 'Idempotency-Key': 'shared' }
  );
  expect(teamDashboard.status).toBe(201);
  const sharedId = (await teamDashboard.json()).data.id;
  expect(
    (
      await invokeV2(read, outsider.token, 'GET', `${path}/${sharedId}`, {
        id: sharedId,
      })
    ).status
  ).toBe(404);
  expect(
    (
      await invokeV2(data, outsider.token, 'GET', `${path}/${sharedId}/data?days=1`, {
        id: sharedId,
      })
    ).status
  ).toBe(404);
  const projection = await invokeV2(data, owner.token, 'GET', `${path}/${sharedId}/data?days=1`, {
    id: sharedId,
  });
  expect(projection.status, await projection.clone().text()).toBe(200);
  expect((await projection.json()).data).toMatchObject({ dashboardId: sharedId, windowDays: 1 });
  expect(
    (
      await invokeV2(
        create,
        outsider.token,
        'POST',
        path,
        {},
        {
          name: 'Steal',
          visibility: 'TEAM',
          teamId: team.id,
        },
        { 'Idempotency-Key': 'steal' }
      )
    ).status
  ).toBe(403);
  const member = await createV2Credential(['reports:read', 'reports:write'], 'USER');
  await db.teamMember.create({ data: { teamId: team.id, userId: member.user.id, role: 'MEMBER' } });
  expect(
    (
      await invokeV2(read, member.token, 'GET', `${path}/${sharedId}`, {
        id: sharedId,
      })
    ).status
  ).toBe(200);
  await db.teamMember.delete({
    where: { userId_teamId: { userId: member.user.id, teamId: team.id } },
  });
  expect(
    (
      await invokeV2(read, member.token, 'GET', `${path}/${sharedId}`, {
        id: sharedId,
      })
    ).status
  ).toBe(404);
  expect(
    (
      await invokeV2(
        update,
        member.token,
        'PATCH',
        `${path}/${sharedId}`,
        { id: sharedId },
        {
          name: 'Unauthorized',
        },
        { 'If-Match': '"1"', 'Idempotency-Key': 'not-owner' }
      )
    ).status
  ).toBe(404);
});

it('downloads a bounded audited dashboard snapshot with the same actor and filter controls as data reads', async () => {
  const owner = await createV2Credential(['reports:read', 'incidents:read'], 'USER');
  const outsider = await createV2Credential(['reports:read', 'incidents:read'], 'USER');
  const dashboard = await db.dashboard.create({
    data: {
      name: 'Private metric data',
      userId: owner.user.id,
      layout: {},
      config: { timeRange: 14 },
    },
  });
  const path = `/dashboards/${dashboard.id}/export?days=3`;
  const exported = await invokeV2(downloadData, owner.token, 'GET', path, { id: dashboard.id });
  expect(exported.status, await exported.clone().text()).toBe(200);
  expect(exported.headers.get('content-type')).toContain('application/json');
  expect(exported.headers.get('cache-control')).toBe('private, no-store');
  expect(exported.headers.get('content-disposition')).toContain('attachment;');
  const bytes = Buffer.from(await exported.arrayBuffer());
  expect(Number(exported.headers.get('content-length'))).toBe(bytes.length);
  expect(exported.headers.get('x-content-sha256')).toBe(
    createHash('sha256').update(bytes).digest('hex')
  );
  expect(JSON.parse(bytes.toString())).toMatchObject({ dashboardId: dashboard.id, windowDays: 3 });
  expect(
    await db.auditLog.count({
      where: { action: 'dashboard.export.downloaded', entityId: dashboard.id },
    })
  ).toBe(1);
  expect(
    (await invokeV2(downloadData, outsider.token, 'GET', path, { id: dashboard.id })).status
  ).toBe(404);
  expect(
    (
      await invokeV2(
        downloadData,
        owner.token,
        'GET',
        `/dashboards/${dashboard.id}/export?days=91`,
        { id: dashboard.id }
      )
    ).status
  ).toBe(400);
  await db.apiKey.update({ where: { id: owner.key.id }, data: { scopes: ['reports:read'] } });
  expect(
    (await invokeV2(downloadData, owner.token, 'GET', path, { id: dashboard.id })).status
  ).toBe(403);
});
