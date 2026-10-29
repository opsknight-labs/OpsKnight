import { beforeEach, expect, it } from 'vitest';
import { GET, PATCH } from '@/app/api/v2/users/me/notification-preferences/route';
import { encryptProviderConfig } from '@/lib/encrypted-provider-config';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import { resetDatabase, testPrisma as db } from '../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
});

const path = '/users/me/notification-preferences';
const preferences = {
  emailEnabled: true,
  smsEnabled: false,
  pushEnabled: false,
  voiceEnabled: false,
  whatsappEnabled: false,
  phoneNumber: '+14155550123',
};

it('lets a USER credential read and revision-protect only its own preferences', async () => {
  const credential = await createV2Credential(
    ['notification-preferences:read', 'notification-preferences:write'],
    'USER'
  );
  await db.notificationProvider.create({
    data: {
      provider: 'smtp',
      enabled: true,
      config: (await encryptProviderConfig('smtp', {
        host: 'mail.example.invalid',
        user: 'fixture',
        password: 'test-password',
        port: 2525,
      })) as never,
    },
  });
  const first = await invokeV2(GET, credential.token, 'GET', path, {});
  expect(first.status).toBe(200);
  expect(first.headers.get('etag')).toBe(`"${credential.user.revision}"`);
  const results = await Promise.all(
    [1, 2, 3].map(() =>
      invokeV2(PATCH, credential.token, 'PATCH', path, {}, preferences, {
        'If-Match': first.headers.get('etag')!,
        'Idempotency-Key': 'preferences-1',
      })
    )
  );
  expect(results.map(result => result.status)).toEqual([200, 200, 200]);
  for (const result of results)
    expect((await result.json()).data).toMatchObject({ emailNotificationsEnabled: true });
  expect(results[0].headers.get('etag')).not.toBe(first.headers.get('etag'));
  const audit = await db.auditLog.findFirstOrThrow({
    where: { action: 'user.notification_preferences.updated' },
  });
  expect(
    await db.auditLog.count({ where: { action: 'user.notification_preferences.updated' } })
  ).toBe(1);
  expect(audit).toMatchObject({ actorId: credential.user.id });
  expect(JSON.stringify(audit)).not.toContain('test-password');
  expect(JSON.stringify(audit)).not.toContain('+14155550123');
});

it('requires dedicated scopes, a configured channel, a retry key and a current revision', async () => {
  const readOnly = await createV2Credential(['notification-preferences:read'], 'USER');
  const read = await invokeV2(GET, readOnly.token, 'GET', path, {});
  expect(read.status).toBe(200);
  expect(
    (
      await invokeV2(PATCH, readOnly.token, 'PATCH', path, {}, preferences, {
        'If-Match': read.headers.get('etag')!,
        'Idempotency-Key': 'missing-write',
      })
    ).status
  ).toBe(403);
  const adminScopeOnly = await createV2Credential(['admin:manage'], 'USER');
  expect((await invokeV2(GET, adminScopeOnly.token, 'GET', path, {})).status).toBe(403);
  const writer = await createV2Credential(
    ['notification-preferences:read', 'notification-preferences:write'],
    'USER'
  );
  const current = await invokeV2(GET, writer.token, 'GET', path, {});
  expect(
    (
      await invokeV2(PATCH, writer.token, 'PATCH', path, {}, preferences, {
        'If-Match': current.headers.get('etag')!,
      })
    ).status
  ).toBe(400);
  expect(
    (
      await invokeV2(PATCH, writer.token, 'PATCH', path, {}, preferences, {
        'If-Match': current.headers.get('etag')!,
        'Idempotency-Key': 'no-provider',
      })
    ).status
  ).toBe(409);
  expect(
    (
      await invokeV2(
        PATCH,
        writer.token,
        'PATCH',
        path,
        {},
        {
          ...preferences,
          emailEnabled: false,
          timeZone: 'Asia/Kolkata',
        },
        { 'If-Match': '"999"', 'Idempotency-Key': 'stale' }
      )
    ).status
  ).toBe(412);
});
