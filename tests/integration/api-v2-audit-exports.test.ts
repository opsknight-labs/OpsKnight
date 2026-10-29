import { beforeEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { POST } from '@/app/api/v2/audit-exports/route';
import { GET as status } from '@/app/api/v2/audit-exports/[id]/route';
import { GET as download } from '@/app/api/v2/audit-exports/[id]/download/route';
import { processPendingJobsByType } from '@/lib/jobs/queue';
import { expireDueAuditExports } from '@/lib/api-v2/audit-exports';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import { resetDatabase, testPrisma as db } from '../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
});

function filter() {
  return {
    from: new Date(Date.now() - 86_400_000).toISOString(),
    to: new Date(Date.now() - 1000).toISOString(),
    maxRecords: 10,
  };
}

it('exports redacted immutable evidence with a verified checksum and owner access', async () => {
  const owner = await createV2Credential(['audit:export'], 'AUDITOR');
  const other = await createV2Credential(['audit:export'], 'AUDITOR');
  const readOnly = await createV2Credential(['audit:read'], 'AUDITOR');
  await db.auditLog.create({
    data: {
      action: 'test.secret.changed',
      entityType: 'SYSTEM_CONFIG',
      details: { apiToken: 'sensitive-token-value', visible: 'safe' },
      createdAt: new Date(Date.now() - 3600_000),
    },
  });
  const body = filter();
  expect(
    (
      await invokeV2(POST, readOnly.token, 'POST', '/audit-exports', {}, body, {
        'Idempotency-Key': 'audit-denied',
      })
    ).status
  ).toBe(403);
  const headers = { 'Idempotency-Key': 'audit-export-once' };
  const created = await invokeV2(POST, owner.token, 'POST', '/audit-exports', {}, body, headers);
  expect(created.status, await created.clone().text()).toBe(201);
  const id = (await created.json()).data.id as string;
  expect(
    (await invokeV2(POST, owner.token, 'POST', '/audit-exports', {}, body, headers)).headers.get(
      'idempotency-replayed'
    )
  ).toBe('true');
  await db.backgroundJob.updateMany({
    where: { type: 'AUDIT_EXPORT' },
    data: { maxAttempts: 1, scheduledAt: new Date(Date.now() - 60_000) },
  });
  expect((await processPendingJobsByType('AUDIT_EXPORT', 1, 1)).processed).toBe(1);
  const path = `/audit-exports/${id}`;
  expect(
    (await (await invokeV2(status, owner.token, 'GET', path, { id })).json()).data.status
  ).toBe('COMPLETED');
  const result = await invokeV2(download, owner.token, 'GET', `${path}/download`, { id });
  expect(result.status, await result.clone().text()).toBe(200);
  const bytes = Buffer.from(await result.arrayBuffer());
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(
    result.headers.get('x-content-sha256')
  );
  const evidence = JSON.parse(bytes.toString('utf8'));
  expect(evidence.recordCount).toBe(1);
  expect(JSON.stringify(evidence)).not.toContain('sensitive-token-value');
  expect((await invokeV2(download, other.token, 'GET', `${path}/download`, { id })).status).toBe(
    404
  );
  expect(await db.auditLog.count({ where: { entityType: 'AUDIT_EXPORT' } })).toBe(2);
  await db.auditExport.update({ where: { id }, data: { checksum: '0'.repeat(64) } });
  expect((await invokeV2(download, owner.token, 'GET', `${path}/download`, { id })).status).toBe(
    409
  );
  expect(await db.auditLog.count({ where: { action: 'audit.export.downloaded' } })).toBe(1);
  await db.auditExport.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  expect((await expireDueAuditExports()).count).toBe(1);
  expect((await invokeV2(download, owner.token, 'GET', `${path}/download`, { id })).status).toBe(
    404
  );
});

it('fails the job on overflow and rechecks credential authority in the worker', async () => {
  const owner = await createV2Credential(['audit:export'], 'ADMIN');
  await db.auditLog.createMany({
    data: [1, 2].map(index => ({
      action: `test.event.${index}`,
      entityType: 'SYSTEM_CONFIG' as const,
      createdAt: new Date(Date.now() - 3600_000),
    })),
  });
  const first = await invokeV2(
    POST,
    owner.token,
    'POST',
    '/audit-exports',
    {},
    { ...filter(), maxRecords: 1 },
    { 'Idempotency-Key': 'audit-overflow' }
  );
  expect(first.status).toBe(201);
  await db.backgroundJob.updateMany({
    where: { type: 'AUDIT_EXPORT' },
    data: { maxAttempts: 1, scheduledAt: new Date(Date.now() - 60_000) },
  });
  expect((await processPendingJobsByType('AUDIT_EXPORT', 1, 1)).failed).toBe(1);
  expect((await db.auditExport.findFirstOrThrow()).encryptedPayload).toBeNull();
  const second = await invokeV2(POST, owner.token, 'POST', '/audit-exports', {}, filter(), {
    'Idempotency-Key': 'audit-revoke',
  });
  expect(second.status).toBe(201);
  await db.apiKey.update({ where: { id: owner.key.id }, data: { scopes: ['audit:read'] } });
  expect((await processPendingJobsByType('AUDIT_EXPORT', 1, 1)).failed).toBe(1);
});
