import { beforeEach, expect, it } from 'vitest';
import { GET, PUT } from '@/app/api/v2/postmortems/[id]/action-items/route';
import { POST } from '@/app/api/v2/postmortems/route';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import {
  createTestIncident,
  createTestService,
  resetDatabase,
  testPrisma as db,
} from '../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test database required');
  await resetDatabase();
});

it('replaces corrective actions atomically with revision fencing, replay and audit', async () => {
  const writer = await createV2Credential([
    'postmortems:read',
    'postmortems:write',
    'incidents:read',
  ]);
  const reader = await createV2Credential(['postmortems:read', 'incidents:read']);
  const service = await createTestService('Action items');
  const incident = await createTestIncident('Action item incident', service.id, {
    status: 'RESOLVED',
  });
  const created = await invokeV2(
    POST,
    writer.token,
    'POST',
    '/postmortems',
    {},
    {
      incidentId: incident.id,
      summary: 'Corrective actions are needed',
    },
    { 'Idempotency-Key': 'action-items-create-parent' }
  );
  const id = (await created.json()).data.id as string;
  const path = `/postmortems/${id}/action-items`;
  const initial = await invokeV2(GET, reader.token, 'GET', path, { id });
  expect(initial.status).toBe(200);
  expect((await initial.json()).data.items).toEqual([]);
  expect(
    (
      await invokeV2(
        PUT,
        reader.token,
        'PUT',
        path,
        { id },
        { items: [] },
        {
          'If-Match': initial.headers.get('etag')!,
          'Idempotency-Key': 'reader-denied',
        }
      )
    ).status
  ).toBe(403);
  const first = await invokeV2(
    PUT,
    writer.token,
    'PUT',
    path,
    { id },
    {
      items: [
        {
          title: 'Add a regression test',
          description: 'Cover the failure mode',
          ownerId: null,
          dueDate: '2026-11-02',
          status: 'OPEN',
          priority: 'HIGH',
        },
      ],
    },
    { 'If-Match': initial.headers.get('etag')!, 'Idempotency-Key': 'action-items-first' }
  );
  expect(first.status).toBe(200);
  const result = (await first.json()).data;
  expect(result.items).toHaveLength(1);
  expect(result.items[0]).toMatchObject({ title: 'Add a regression test', priority: 'HIGH' });
  const replay = await invokeV2(
    PUT,
    writer.token,
    'PUT',
    path,
    { id },
    {
      items: [
        {
          title: 'Add a regression test',
          description: 'Cover the failure mode',
          ownerId: null,
          dueDate: '2026-11-02',
          status: 'OPEN',
          priority: 'HIGH',
        },
      ],
    },
    { 'If-Match': initial.headers.get('etag')!, 'Idempotency-Key': 'action-items-first' }
  );
  expect(replay.status).toBe(200);
  expect(replay.headers.get('idempotency-replayed')).toBe('true');
  const stale = await invokeV2(
    PUT,
    writer.token,
    'PUT',
    path,
    { id },
    { items: [] },
    {
      'If-Match': initial.headers.get('etag')!,
      'Idempotency-Key': 'action-items-stale',
    }
  );
  expect(stale.status).toBe(412);
  const completed = await invokeV2(
    PUT,
    writer.token,
    'PUT',
    path,
    { id },
    {
      items: [
        {
          id: result.items[0].id,
          title: 'Add a regression test',
          description: 'Covered',
          ownerId: null,
          dueDate: '2026-11-02',
          status: 'COMPLETED',
          priority: 'HIGH',
        },
      ],
    },
    { 'If-Match': first.headers.get('etag')!, 'Idempotency-Key': 'action-items-complete' }
  );
  expect(completed.status).toBe(200);
  expect(
    (await db.actionItem.findFirstOrThrow({ where: { postmortemId: id } })).completedAt
  ).not.toBeNull();
  const cleared = await invokeV2(
    PUT,
    writer.token,
    'PUT',
    path,
    { id },
    { items: [] },
    {
      'If-Match': completed.headers.get('etag')!,
      'Idempotency-Key': 'action-items-clear',
    }
  );
  expect(cleared.status).toBe(200);
  expect(await db.actionItem.count({ where: { postmortemId: id } })).toBe(0);
  expect(
    await db.auditLog.count({
      where: { action: 'postmortem.action_items.replaced', entityId: incident.id },
    })
  ).toBe(3);
});

it('migrates legacy UI actions on complete replacement and rejects foreign identifiers', async () => {
  const writer = await createV2Credential([
    'postmortems:read',
    'postmortems:write',
    'incidents:read',
  ]);
  const service = await createTestService('Legacy actions');
  const incident = await createTestIncident('Legacy incident', service.id, { status: 'RESOLVED' });
  const parent = await db.postmortem.create({
    data: {
      incidentId: incident.id,
      title: 'Legacy postmortem',
      summary: 'Legacy corrective actions',
      actionItems: [
        {
          id: 'legacy-1',
          title: 'Document recovery',
          description: 'Write the runbook',
          status: 'OPEN',
          priority: 'MEDIUM',
        },
      ],
    },
  });
  const path = `/postmortems/${parent.id}/action-items`;
  const read = await invokeV2(GET, writer.token, 'GET', path, { id: parent.id });
  expect(read.status).toBe(200);
  const before = (await read.json()).data;
  expect(before.items).toHaveLength(1);
  const foreign = await invokeV2(
    PUT,
    writer.token,
    'PUT',
    path,
    { id: parent.id },
    {
      items: [
        {
          id: 'foreign-item',
          title: 'Invalid',
          description: '',
          ownerId: null,
          dueDate: null,
          status: 'OPEN',
          priority: 'LOW',
        },
      ],
    },
    { 'If-Match': read.headers.get('etag')!, 'Idempotency-Key': 'foreign-action-id' }
  );
  expect(foreign.status).toBe(400);
  const replaced = await invokeV2(
    PUT,
    writer.token,
    'PUT',
    path,
    { id: parent.id },
    {
      items: [
        {
          id: before.items[0].id,
          title: 'Document recovery',
          description: 'Write the runbook',
          ownerId: null,
          dueDate: null,
          status: 'IN_PROGRESS',
          priority: 'MEDIUM',
        },
      ],
    },
    { 'If-Match': read.headers.get('etag')!, 'Idempotency-Key': 'legacy-action-migrate' }
  );
  expect(replaced.status).toBe(200);
  expect(await db.actionItem.count({ where: { postmortemId: parent.id } })).toBe(1);
  expect(
    (await db.actionItem.findFirstOrThrow({ where: { postmortemId: parent.id } })).status
  ).toBe('IN_PROGRESS');
});

it('preserves existing Jira metadata while updating relational action status', async () => {
  const writer = await createV2Credential([
    'postmortems:read',
    'postmortems:write',
    'incidents:read',
  ]);
  const service = await createTestService('Linked action');
  const incident = await createTestIncident('Linked incident', service.id, { status: 'RESOLVED' });
  const parent = await db.postmortem.create({
    data: {
      incidentId: incident.id,
      title: 'Linked postmortem',
      summary: 'A linked issue',
      actionItems: [
        {
          id: 'linked-1',
          title: 'Patch service',
          description: '',
          status: 'OPEN',
          priority: 'HIGH',
          externalIssue: {
            linkId: 'link-1',
            provider: 'JIRA',
            key: 'OPS-1',
            url: 'https://example.com/OPS-1',
          },
        },
      ],
      actionItemRecords: {
        create: [
          {
            id: 'linked-1',
            incidentId: incident.id,
            title: 'Patch service',
            status: 'OPEN',
            priority: 'HIGH',
          },
        ],
      },
    },
  });
  const path = `/postmortems/${parent.id}/action-items`;
  const changed = await invokeV2(
    PUT,
    writer.token,
    'PUT',
    path,
    { id: parent.id },
    {
      items: [
        {
          id: 'linked-1',
          title: 'Patch service',
          description: '',
          ownerId: null,
          dueDate: null,
          status: 'COMPLETED',
          priority: 'HIGH',
        },
      ],
    },
    { 'If-Match': `"${parent.revision}"`, 'Idempotency-Key': 'linked-action-complete' }
  );
  expect(changed.status).toBe(200);
  const stored = await db.postmortem.findUniqueOrThrow({ where: { id: parent.id } });
  expect(JSON.stringify(stored.actionItems)).toContain('OPS-1');
  expect(JSON.stringify(stored.actionItems)).toContain('COMPLETED');
});
