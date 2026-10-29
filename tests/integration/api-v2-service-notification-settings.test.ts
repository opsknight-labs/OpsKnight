import { beforeEach, expect, it } from 'vitest';
import { GET, PATCH } from '@/app/api/v2/services/[id]/notification-settings/route';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import { createTestService, resetDatabase, testPrisma as db } from '../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) {
    throw new Error('Dedicated test DB required');
  }
  await resetDatabase();
});

it('updates revision-fenced notification policy once and disables Slack destinations atomically', async () => {
  const admin = await createV2Credential(['services:read', 'services:write']);
  const service = await createTestService('Notification policy', null, {
    serviceNotificationChannels: ['SLACK', 'EMAIL'],
  });
  const destination = await db.slackDestination.create({
    data: { serviceId: service.id, workspaceId: 'test-workspace', channelId: 'C_TEST' },
  });
  const path = `/services/${service.id}/notification-settings`;
  const params = { id: service.id };
  const before = await invokeV2(GET, admin.token, 'GET', path, params);
  expect(before.status).toBe(200);
  const etag = before.headers.get('etag')!;
  const payload = { serviceNotificationChannels: ['EMAIL'], serviceNotifyOnSlaBreach: true };
  const mutate = (key: string, tag: string) => invokeV2(PATCH, admin.token, 'PATCH', path, params, payload, {
    'If-Match': tag, 'Idempotency-Key': key,
  });
  const changed = await mutate('notification-settings-1', etag);
  expect(changed.status).toBe(200);
  expect((await changed.json()).data).toMatchObject(payload);
  expect(changed.headers.get('etag')).not.toBe(etag);
  const replay = await mutate('notification-settings-1', etag);
  expect(replay.status).toBe(200);
  expect(replay.headers.get('idempotency-replayed')).toBe('true');
  expect((await mutate('notification-settings-2', etag)).status).toBe(412);
  expect((await db.slackDestination.findUniqueOrThrow({ where: { id: destination.id } })).enabled).toBe(false);
  expect(await db.auditLog.count({ where: { action: 'service.notifications.updated' } })).toBe(1);
});

it('rejects unprivileged writers and malformed channel configuration', async () => {
  const admin = await createV2Credential(['services:read', 'services:write']);
  const reader = await createV2Credential(['services:write'], 'USER');
  const service = await createTestService('Restricted notification policy');
  const path = `/services/${service.id}/notification-settings`;
  const params = { id: service.id };
  const etag = (await invokeV2(GET, admin.token, 'GET', path, params)).headers.get('etag')!;
  const headers = { 'If-Match': etag, 'Idempotency-Key': 'invalid-policy' };
  expect((await invokeV2(PATCH, reader.token, 'PATCH', path, params, { serviceNotifyOnAck: false }, headers)).status).toBe(403);
  expect((await invokeV2(PATCH, admin.token, 'PATCH', path, params, { serviceNotificationChannels: ['VOICE'] }, headers)).status).toBe(400);
});
