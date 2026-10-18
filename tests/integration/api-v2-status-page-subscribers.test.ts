import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { getOpenApiV2Spec } from '@/lib/api-v2/openapi';
import { beforeEach, expect, it } from 'vitest';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import { testPrisma as db, resetDatabase } from '../helpers/test-db';
import { GET as list } from '@/app/api/v2/status-pages/[id]/subscribers/route';
import {
  GET as read,
  DELETE as remove,
} from '@/app/api/v2/status-pages/[id]/subscribers/[subscriberId]/route';
import { GET as stats } from '@/app/api/v2/status-pages/[id]/subscriber-stats/route';
import { GET as settings } from '@/app/api/v2/status-pages/[id]/subscription-settings/route';
import { removeStatusPageSubscribers } from '@/lib/status-pages/subscriber-administration';
const scopes = [
  'status-page-subscribers:read',
  'status-page-subscribers:write',
  'status-pages:read',
];
beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test database required');
  await resetDatabase();
});
async function fixture() {
  const credential = await createV2Credential(scopes);
  const page = await db.statusPage.create({
    data: { name: 'Subscriber fixture', slug: `subs-${crypto.randomUUID()}` },
  });
  const subscriber = await db.statusPageSubscription.create({
    data: {
      statusPageId: page.id,
      email: 'subscriber@example.com',
      phone: '+15555551234',
      token: crypto.randomUUID(),
      verificationToken: crypto.randomUUID(),
      verified: true,
      state: 'ACTIVE',
      preferences: { hidden: 'private' },
    },
  });
  const path = `/status-pages/${page.id}`;
  return {
    credential,
    page,
    subscriber,
    path,
    params: { id: page.id, subscriberId: subscriber.id },
  };
}
it('returns bounded privacy DTOs, consistent counts and supported consent settings without secrets', async () => {
  const f = await fixture();
  const response = await invokeV2(
    read,
    f.credential.token,
    'GET',
    `${f.path}/subscribers/${f.subscriber.id}`,
    f.params
  );
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const data = (await response.json()).data;
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  ajv.addSchema({ $id: 'subscriber-spec', components: getOpenApiV2Spec().components });
  const validate = ajv.getSchema('subscriber-spec#/components/schemas/StatusPageSubscriber')!;
  expect(validate(data), JSON.stringify(validate.errors)).toBe(true);
  expect(data).toMatchObject({ id: f.subscriber.id, email: f.subscriber.email, state: 'ACTIVE' });
  for (const key of ['token', 'verificationToken', 'phone', 'preferences', 'suppressionReason'])
    expect(data).not.toHaveProperty(key);
  const count = await invokeV2(stats, f.credential.token, 'GET', `${f.path}/subscriber-stats`, {
    id: f.page.id,
  });
  expect((await count.json()).data).toMatchObject({
    total: 1,
    states: [{ state: 'ACTIVE', count: 1 }],
  });
  const config = await invokeV2(
    settings,
    f.credential.token,
    'GET',
    `${f.path}/subscription-settings`,
    { id: f.page.id }
  );
  expect((await config.json()).data).toMatchObject({
    verificationRequired: true,
    publicRegistrationSeparate: true,
  });
});
it('paginates tied subscription dates without duplicates and rejects forged cursors', async () => {
  const f = await fixture();
  await db.statusPageSubscription.create({
    data: {
      statusPageId: f.page.id,
      email: 'second@example.com',
      token: crypto.randomUUID(),
      subscribedAt: f.subscriber.subscribedAt,
    },
  });
  const first = await invokeV2(list, f.credential.token, 'GET', `${f.path}/subscribers?limit=1`, {
    id: f.page.id,
  });
  const a = await first.json();
  expect(a.pagination.hasMore).toBe(true);
  const second = await invokeV2(
    list,
    f.credential.token,
    'GET',
    `${f.path}/subscribers?limit=1&cursor=${a.pagination.nextCursor}`,
    { id: f.page.id }
  );
  const b = await second.json();
  expect(b.data[0].id).not.toBe(a.data[0].id);
  expect(b.pagination.hasMore).toBe(false);
  expect(
    (
      await invokeV2(list, f.credential.token, 'GET', `${f.path}/subscribers?cursor=forged`, {
        id: f.page.id,
      })
    ).status
  ).toBe(400);
});
it('revokes consent and pending deliveries atomically, with one canonical audit across different replay keys', async () => {
  const f = await fixture();
  const notification = await db.notification.create({
    data: {
      channel: 'EMAIL',
      recipientType: 'SUBSCRIBER',
      recipientId: f.subscriber.id,
      recipientHash: 'subscriber-fixture-hash',
      payloadEncrypted: 'encrypted-payload',
    },
  });
  const call = (key: string) =>
    invokeV2(
      remove,
      f.credential.token,
      'DELETE',
      `${f.path}/subscribers/${f.subscriber.id}`,
      f.params,
      undefined,
      { 'Idempotency-Key': key }
    );
  expect((await call('remove-subscriber-one')).status).toBe(204);
  expect((await call('remove-subscriber-one')).status).toBe(204);
  expect((await call('remove-subscriber-two')).status).toBe(204);
  expect(
    (await db.statusPageSubscription.findUniqueOrThrow({ where: { id: f.subscriber.id } })).state
  ).toBe('UNSUBSCRIBED');
  expect(await db.notification.findUniqueOrThrow({ where: { id: notification.id } })).toMatchObject(
    { status: 'SKIPPED', payloadEncrypted: null }
  );
  const audits = await db.auditLog.findMany({
    where: { action: 'status_page.subscribers.removed' },
  });
  expect(audits).toHaveLength(1);
  expect(audits[0].details).toMatchObject({
    source: 'API',
    metadata: { apiClientId: f.credential.key.id },
  });
  expect(JSON.stringify(audits)).not.toContain(f.subscriber.email);
});
it.each(['RESPONDER', 'AUDITOR', 'USER'] as const)(
  'denies %s despite explicit subscriber scopes',
  async role => {
    const f = await fixture();
    const other = await createV2Credential(scopes, role);
    expect(
      (
        await invokeV2(
          read,
          other.token,
          'GET',
          `${f.path}/subscribers/${f.subscriber.id}`,
          f.params
        )
      ).status
    ).toBe(403);
    expect(
      (
        await invokeV2(
          remove,
          other.token,
          'DELETE',
          `${f.path}/subscribers/${f.subscriber.id}`,
          f.params,
          undefined,
          { 'Idempotency-Key': 'denied' }
        )
      ).status
    ).toBe(403);
  }
);
it('does not imply subscriber privacy permission from broad status/admin scopes and rechecks role on replay', async () => {
  const f = await fixture();
  const broad = await createV2Credential([
    'status-pages:read',
    'status-pages:write',
    'admin:manage',
  ]);
  expect(
    (await invokeV2(read, broad.token, 'GET', `${f.path}/subscribers/${f.subscriber.id}`, f.params))
      .status
  ).toBe(403);
  const call = () =>
    invokeV2(
      remove,
      f.credential.token,
      'DELETE',
      `${f.path}/subscribers/${f.subscriber.id}`,
      f.params,
      undefined,
      { 'Idempotency-Key': 'demotion' }
    );
  expect((await call()).status).toBe(204);
  await db.user.update({ where: { id: f.credential.user.id }, data: { role: 'AUDITOR' } });
  expect((await call()).status).toBe(403);
});
it('scopes nested identifiers to the page and rejects missing resources', async () => {
  const f = await fixture();
  const id = `c${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`;
  expect(
    (
      await invokeV2(
        read,
        f.credential.token,
        'GET',
        `/status-pages/${id}/subscribers/${f.subscriber.id}`,
        { id, subscriberId: f.subscriber.id }
      )
    ).status
  ).toBe(404);
  expect(
    (
      await invokeV2(read, f.credential.token, 'GET', `${f.path}/subscribers/${id}`, {
        id: f.page.id,
        subscriberId: id,
      })
    ).status
  ).toBe(404);
});
it('shared UI/domain revocation joins its caller transaction and rolls back delivery suppression and audit', async () => {
  const f = await fixture();
  const notification = await db.notification.create({
    data: {
      channel: 'EMAIL',
      recipientType: 'SUBSCRIBER',
      recipientId: f.subscriber.id,
      recipientHash: 'subscriber-fixture-hash',
    },
  });
  await expect(
    db.$transaction(async tx => {
      await removeStatusPageSubscribers(f.page.id, [f.subscriber.id], f.credential.user.id, tx);
      throw new Error('Outer rollback');
    })
  ).rejects.toThrow('Outer rollback');
  expect(
    (await db.statusPageSubscription.findUniqueOrThrow({ where: { id: f.subscriber.id } })).state
  ).toBe('ACTIVE');
  expect((await db.notification.findUniqueOrThrow({ where: { id: notification.id } })).status).toBe(
    'PENDING'
  );
  expect(await db.auditLog.count({ where: { action: 'status_page.subscribers.removed' } })).toBe(0);
});

it('requires replay keys, denies revoked credentials and keeps concurrent removals canonical', async () => {
  const f = await fixture();
  const path = `${f.path}/subscribers/${f.subscriber.id}`;
  expect((await invokeV2(remove, f.credential.token, 'DELETE', path, f.params)).status).toBe(400);
  const calls = await Promise.all(
    ['concurrent-a', 'concurrent-b'].map(key =>
      invokeV2(remove, f.credential.token, 'DELETE', path, f.params, undefined, {
        'Idempotency-Key': key,
      })
    )
  );
  expect(calls.map(row => row.status)).toEqual([204, 204]);
  expect(await db.auditLog.count({ where: { action: 'status_page.subscribers.removed' } })).toBe(1);
  await db.apiKey.update({ where: { id: f.credential.key.id }, data: { revokedAt: new Date() } });
  expect(
    (
      await invokeV2(remove, f.credential.token, 'DELETE', path, f.params, undefined, {
        'Idempotency-Key': 'concurrent-a',
      })
    ).status
  ).toBe(401);
});

it('rolls back revocation and replay when canonical audit persistence fails, allowing the same key to retry', async () => {
  const f = await fixture();
  await db.$executeRawUnsafe(
    `CREATE FUNCTION test_subscriber_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'status_page.subscribers.removed' THEN RAISE EXCEPTION 'Audit unavailable'; END IF; RETURN NEW; END; $$`
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER test_subscriber_audit_failure_trigger BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION test_subscriber_audit_failure()`
  );
  const call = () =>
    invokeV2(
      remove,
      f.credential.token,
      'DELETE',
      `${f.path}/subscribers/${f.subscriber.id}`,
      f.params,
      undefined,
      { 'Idempotency-Key': 'audit-recovery' }
    );
  try {
    expect((await call()).status).toBe(500);
    expect(
      (await db.statusPageSubscription.findUniqueOrThrow({ where: { id: f.subscriber.id } })).state
    ).toBe('ACTIVE');
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER test_subscriber_audit_failure_trigger ON "AuditLog"');
    await db.$executeRawUnsafe('DROP FUNCTION test_subscriber_audit_failure()');
  }
  expect((await call()).status).toBe(204);
  expect(await db.auditLog.count({ where: { action: 'status_page.subscribers.removed' } })).toBe(1);
});
