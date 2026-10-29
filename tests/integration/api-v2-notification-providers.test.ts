import { beforeEach, expect, it, vi } from 'vitest';
import { processCentralNotificationQueue } from '@/lib/notification-control-plane';

const delivery = vi.hoisted(() => ({ sendEmail: vi.fn() }));
vi.mock('@/lib/email', async original => ({
  ...(await original<typeof import('@/lib/email')>()),
  sendEmail: delivery.sendEmail,
}));
import { GET as listProviders } from '@/app/api/v2/notification-providers/route';
import {
  GET as getProvider,
  PUT as configureProvider,
} from '@/app/api/v2/notification-providers/[provider]/route';
import { GET as getDiagnostics } from '@/app/api/v2/notification-providers/[provider]/diagnostics/route';
import { POST as testProvider } from '@/app/api/v2/notification-providers/[provider]/test/route';
import { POST as rotateWebPush } from '@/app/api/v2/notification-providers/web-push/rotate/route';
import { decryptProviderConfig, encryptProviderConfig } from '@/lib/encrypted-provider-config';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import { resetDatabase, testPrisma as db } from '../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
  delivery.sendEmail.mockReset();
});

it('returns only redacted provider state and updates existing credentials with revision, audit, and replay fences', async () => {
  const credential = await createV2Credential(
    ['notification-providers:read', 'notification-providers:write'],
    'ADMIN'
  );
  const secret = 'resend-production-secret-never-return-this';
  await db.notificationProvider.create({
    data: {
      provider: 'resend',
      enabled: true,
      config: (await encryptProviderConfig('resend', {
        apiKey: secret,
        fromEmail: 'alerts@example.com',
      })) as never,
    },
  });

  const path = '/notification-providers/resend';
  const detail = await invokeV2(getProvider, credential.token, 'GET', path, { provider: 'resend' });
  const detailBody = await detail.json();
  expect(detail.status).toBe(200);
  expect(detail.headers.get('etag')).toBe('"1"');
  expect(JSON.stringify(detailBody)).not.toContain(secret);
  expect(detailBody.data.config).toMatchObject({ apiKey: '••••••••', hasApiKey: true });
  expect(
    (await invokeV2(listProviders, credential.token, 'GET', '/notification-providers', {})).status
  ).toBe(200);

  const update = {
    provider: 'resend',
    enabled: true,
    config: { apiKey: 'resend-rotated-secret', fromEmail: 'oncall@example.com' },
  };
  const save = () =>
    invokeV2(configureProvider, credential.token, 'PUT', path, { provider: 'resend' }, update, {
      'If-Match': detail.headers.get('etag')!,
      'Idempotency-Key': 'resend-update-1',
    });
  const saves = await Promise.all([save(), save(), save()]);
  const payloads = await Promise.all(saves.map(response => response.json()));
  expect(
    saves.map(response => response.status),
    JSON.stringify(payloads)
  ).toEqual([200, 200, 200]);
  expect(payloads[0].data.revision).toBe(2);
  expect(JSON.stringify(payloads)).not.toContain('resend-rotated-secret');
  expect(await db.auditLog.count({ where: { action: 'notification_provider.updated' } })).toBe(1);
  const audit = await db.auditLog.findFirstOrThrow({
    where: { action: 'notification_provider.updated' },
  });
  expect(audit.actorId).toBe(credential.user.id);
  expect(JSON.stringify(audit)).not.toContain('resend-rotated-secret');
  const stored = await db.notificationProvider.findUniqueOrThrow({ where: { provider: 'resend' } });
  expect(
    await decryptProviderConfig('resend', stored.config as Record<string, unknown>)
  ).toMatchObject({
    apiKey: 'resend-rotated-secret',
    fromEmail: 'oncall@example.com',
  });
  expect(
    (
      await invokeV2(
        configureProvider,
        credential.token,
        'PUT',
        path,
        { provider: 'resend' },
        update,
        {
          'If-Match': detail.headers.get('etag')!,
          'Idempotency-Key': 'resend-update-stale',
        }
      )
    ).status
  ).toBe(412);
});

it('allows idempotent initial creation without If-Match, retains omitted secrets, and rejects broad admin scope inheritance', async () => {
  const credential = await createV2Credential(
    ['notification-providers:read', 'notification-providers:write'],
    'ADMIN'
  );
  const createdBody = {
    provider: 'sendgrid',
    enabled: false,
    config: { apiKey: 'sendgrid-secret', fromEmail: 'alerts@example.com' },
  };
  const path = '/notification-providers/sendgrid';
  const create = () =>
    invokeV2(
      configureProvider,
      credential.token,
      'PUT',
      path,
      { provider: 'sendgrid' },
      createdBody,
      { 'Idempotency-Key': 'sendgrid-create-1' }
    );
  const results = await Promise.all([create(), create()]);
  const createPayloads = await Promise.all(results.map(result => result.json()));
  expect(
    results.map(result => result.status),
    JSON.stringify(createPayloads)
  ).toEqual([200, 200]);
  expect(await db.notificationProvider.count({ where: { provider: 'sendgrid' } })).toBe(1);

  const detail = await invokeV2(getProvider, credential.token, 'GET', path, {
    provider: 'sendgrid',
  });
  const partial = {
    provider: 'sendgrid',
    enabled: false,
    config: { fromEmail: 'ops@example.com' },
  };
  const update = await invokeV2(
    configureProvider,
    credential.token,
    'PUT',
    path,
    { provider: 'sendgrid' },
    partial,
    {
      'If-Match': detail.headers.get('etag')!,
      'Idempotency-Key': 'sendgrid-preserve-secret',
    }
  );
  const updateBody = await update.json();
  expect(update.status, JSON.stringify(updateBody)).toBe(200);
  const row = await db.notificationProvider.findUniqueOrThrow({ where: { provider: 'sendgrid' } });
  expect(
    await decryptProviderConfig('sendgrid', row.config as Record<string, unknown>)
  ).toMatchObject({
    apiKey: 'sendgrid-secret',
    fromEmail: 'ops@example.com',
  });

  const broadAdminOnly = await createV2Credential(['admin:manage'], 'USER');
  expect(
    (await invokeV2(listProviders, broadAdminOnly.token, 'GET', '/notification-providers', {}))
      .status
  ).toBe(403);
});

it('queues provider tests once and exposes only bounded diagnostics', async () => {
  const credential = await createV2Credential(
    ['notification-providers:read', 'notification-providers:test'],
    'ADMIN'
  );
  const secret = 'smtp-super-secret';
  await db.notificationProvider.create({
    data: {
      provider: 'smtp',
      enabled: true,
      config: (await encryptProviderConfig('smtp', {
        host: 'smtp.example.com',
        port: 587,
        user: 'test',
        password: secret,
        fromEmail: 'alerts@example.com',
      })) as never,
    },
  });
  const path = '/notification-providers/smtp';
  const detail = await invokeV2(getProvider, credential.token, 'GET', path, { provider: 'smtp' });
  const headers = { 'If-Match': detail.headers.get('etag')!, 'Idempotency-Key': 'smtp-test-1' };
  const send = () =>
    invokeV2(
      testProvider,
      credential.token,
      'POST',
      `${path}/test`,
      { provider: 'smtp' },
      {},
      headers
    );
  const sends = await Promise.all([send(), send(), send()]);
  const payloads = await Promise.all(sends.map(response => response.json()));
  expect(
    sends.map(response => response.status),
    JSON.stringify(payloads)
  ).toEqual([202, 202, 202]);
  expect(new Set(payloads.map(payload => payload.data.id)).size).toBe(1);
  expect(await db.notification.count({ where: { eventType: 'provider-test' } })).toBe(1);
  expect(await db.notificationDeliveryAttempt.count()).toBe(0);
  expect(await db.auditLog.count({ where: { action: 'notification_provider.test_queued' } })).toBe(
    1
  );
  const diagnostics = await invokeV2(
    getDiagnostics,
    credential.token,
    'GET',
    `${path}/diagnostics`,
    { provider: 'smtp' }
  );
  const diagnosticBody = await diagnostics.json();
  expect(diagnosticBody.data).toMatchObject({
    provider: 'smtp',
    configurationState: 'READY',
    missingRequiredFields: [],
  });
  expect(JSON.stringify(diagnosticBody)).not.toContain(secret);
  expect(JSON.stringify(diagnosticBody)).not.toContain(credential.user.email);

  delivery.sendEmail.mockResolvedValue({
    success: true,
    providerMessageId: 'smtp-provider-test-receipt',
    selectedProvider: 'smtp',
  });
  const drained = await processCentralNotificationQueue({
    trafficClasses: ['TRANSACTIONAL'],
    batchSize: 1,
    concurrency: 1,
  });
  expect(drained.succeeded).toBe(1);
  expect(delivery.sendEmail).toHaveBeenCalledTimes(1);
  const delivered = await db.notification.findUniqueOrThrow({ where: { id: payloads[0].data.id } });
  expect(delivered.status).toBe('SENT');
  expect(await db.notificationDeliveryAttempt.count({ where: { notificationId: delivered.id } })).toBe(1);
  const postDeliveryDiagnostics = await invokeV2(
    getDiagnostics,
    credential.token,
    'GET',
    `${path}/diagnostics`,
    { provider: 'smtp' }
  );
  expect((await postDeliveryDiagnostics.json()).data.recentTests).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: delivered.id, status: 'SENT' })])
  );
});

it('rotates Web Push keys with private material encrypted and absent from every response', async () => {
  const credential = await createV2Credential(
    ['notification-providers:read', 'notification-providers:write'],
    'ADMIN'
  );
  const { generateVAPIDKeys } = await import('web-push');
  const original = generateVAPIDKeys();
  await db.notificationProvider.create({
    data: {
      provider: 'web-push',
      enabled: false,
      config: (await encryptProviderConfig('web-push', {
        vapidPublicKey: original.publicKey,
        vapidPrivateKey: original.privateKey,
        vapidSubject: 'mailto:admin@example.com',
      })) as never,
    },
  });
  const detail = await invokeV2(
    getProvider,
    credential.token,
    'GET',
    '/notification-providers/web-push',
    { provider: 'web-push' }
  );
  const rotate = await invokeV2(
    rotateWebPush,
    credential.token,
    'POST',
    '/notification-providers/web-push/rotate',
    {},
    { subject: 'mailto:admin@example.com', keepPrevious: true },
    { 'If-Match': detail.headers.get('etag')!, 'Idempotency-Key': 'vapid-rotate-1' }
  );
  const responseBody = await rotate.json();
  expect(rotate.status).toBe(200);
  expect(responseBody.data.publicKey).toBeTruthy();
  expect(JSON.stringify(responseBody)).not.toContain(original.privateKey);
  expect(JSON.stringify(responseBody)).not.toContain('vapidKeyHistory');
  expect(rotate.headers.get('etag')).toBe('"2"');
  const row = await db.notificationProvider.findUniqueOrThrow({ where: { provider: 'web-push' } });
  const raw = row.config as Record<string, unknown>;
  expect(String(raw.vapidPrivateKey)).toMatch(/^enc:/);
  const history = raw.vapidKeyHistory as Array<Record<string, unknown>>;
  expect(history).toHaveLength(1);
  expect(String(history[0]?.privateKey)).toMatch(/^enc:/);
  expect(await decryptProviderConfig('web-push', raw)).toMatchObject({
    vapidKeyHistory: [{ publicKey: original.publicKey, privateKey: original.privateKey }],
  });

  const next = await invokeV2(
    getProvider,
    credential.token,
    'GET',
    '/notification-providers/web-push',
    { provider: 'web-push' }
  );
  const dropHistory = await invokeV2(
    rotateWebPush,
    credential.token,
    'POST',
    '/notification-providers/web-push/rotate',
    {},
    { subject: 'mailto:admin@example.com', keepPrevious: false },
    { 'If-Match': next.headers.get('etag')!, 'Idempotency-Key': 'vapid-rotate-2' }
  );
  expect(dropHistory.status).toBe(200);
  const finalRow = await db.notificationProvider.findUniqueOrThrow({
    where: { provider: 'web-push' },
  });
  expect((finalRow.config as Record<string, unknown>).vapidKeyHistory).toEqual([]);
});
