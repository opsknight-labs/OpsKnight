import { beforeEach, expect, it } from 'vitest';
import { GET, PUT } from '@/app/api/v2/settings/chatops/route';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import { resetDatabase, testPrisma as db } from '../helpers/test-db';
import { saveChatOpsConfiguration } from '@/lib/chatops/config-command';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
});

const body = {
  enabled: true,
  channelPrefix: 'incident',
  autoCreateOnUrgency: ['HIGH'],
  autoCreateOnPriority: ['P1', 'P2'],
  archiveOnResolve: true,
  defaultVideoBridge: 'JITSI',
  customBridgeUrlTemplate: 'https://bridge.example.com/{incidentId}',
  defaultProviders: ['SLACK', 'MICROSOFT_TEAMS'],
};

it('writes UI-equivalent ChatOps and provider policy with revision, replay and audit', async () => {
  const admin = await createV2Credential(['chatops:read', 'chatops:write'], 'ADMIN');
  const reader = await createV2Credential(['chatops:read'], 'ADMIN');
  const initial = await invokeV2(GET, reader.token, 'GET', '/settings/chatops', {});
  expect(initial.status).toBe(200);
  expect((await initial.json()).data.revision).toBe(0);
  expect(
    (
      await invokeV2(PUT, reader.token, 'PUT', '/settings/chatops', {}, body, {
        'If-Match': initial.headers.get('etag')!,
        'Idempotency-Key': 'reader-denied',
      })
    ).status
  ).toBe(403);
  const headers = { 'If-Match': initial.headers.get('etag')!, 'Idempotency-Key': 'chatops-save' };
  const saved = await invokeV2(PUT, admin.token, 'PUT', '/settings/chatops', {}, body, headers);
  expect(saved.status, await saved.clone().text()).toBe(200);
  expect((await saved.json()).data).toMatchObject({
    enabled: true,
    channelPrefix: 'incident',
    revision: 1,
  });
  expect(
    (await invokeV2(PUT, admin.token, 'PUT', '/settings/chatops', {}, body, headers)).headers.get(
      'idempotency-replayed'
    )
  ).toBe('true');
  expect(
    (
      await invokeV2(PUT, admin.token, 'PUT', '/settings/chatops', {}, body, {
        'If-Match': headers['If-Match'],
        'Idempotency-Key': 'chatops-stale',
      })
    ).status
  ).toBe(412);
  expect(
    (
      await db.systemConfig.findUniqueOrThrow({
        where: { key: 'war_room_global_default_providers' },
      })
    ).value
  ).toEqual(['SLACK', 'MICROSOFT_TEAMS']);
  expect(
    (await db.systemConfig.findUniqueOrThrow({ where: { key: 'meeting_global_default_provider' } }))
      .value
  ).toBe('JITSI');
  expect(await db.auditLog.count({ where: { action: 'chatops.config.updated' } })).toBe(1);
  const uiState = await db.chatOpsConfig.findUniqueOrThrow({ where: { id: 'default' } });
  await db.$transaction(tx =>
    saveChatOpsConfiguration(
      { ...body, enabled: false } as Parameters<typeof saveChatOpsConfiguration>[0],
      { updatedAt: uiState.updatedAt },
      { id: admin.user.id, source: 'UI' },
      tx
    )
  );
  expect(
    (
      await invokeV2(PUT, admin.token, 'PUT', '/settings/chatops', {}, body, {
        'If-Match': saved.headers.get('etag')!,
        'Idempotency-Key': 'stale-after-ui',
      })
    ).status
  ).toBe(412);
  expect(await db.auditLog.count({ where: { action: 'chatops.config.updated' } })).toBe(2);
});

it('rejects unsafe bridge templates and unauthorized actors', async () => {
  const admin = await createV2Credential(['chatops:write'], 'ADMIN');
  const responder = await createV2Credential(['chatops:write'], 'RESPONDER');
  expect(
    (
      await invokeV2(
        PUT,
        admin.token,
        'PUT',
        '/settings/chatops',
        {},
        {
          ...body,
          customBridgeUrlTemplate: 'javascript:alert(1)',
        },
        { 'If-Match': '"0"', 'Idempotency-Key': 'bad-template' }
      )
    ).status
  ).toBe(400);
  expect(
    (
      await invokeV2(PUT, responder.token, 'PUT', '/settings/chatops', {}, body, {
        'If-Match': '"0"',
        'Idempotency-Key': 'bad-role',
      })
    ).status
  ).toBe(403);
});
