import { beforeEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { POST as create } from '@/app/api/v2/reports/exports/route';
import { GET as status } from '@/app/api/v2/reports/exports/[id]/route';
import { GET as download } from '@/app/api/v2/reports/exports/[id]/download/route';
import { POST as cancel } from '@/app/api/v2/reports/exports/[id]/cancel/route';
import { processPendingJobsByType } from '@/lib/jobs/queue';
import { expireDueReportExports } from '@/lib/api-v2/report-exports';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import { resetDatabase, testPrisma as db } from '../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) throw new Error('Dedicated test DB required');
  await resetDatabase();
});

const body = { metrics: ['totalIncidents'], windowDays: 1 };

it('queues once, processes through the worker, verifies integrity and checks authorization at download', async () => {
  const owner = await createV2Credential(['reports:read', 'incidents:read'], 'ADMIN');
  const other = await createV2Credential(['reports:read', 'incidents:read'], 'ADMIN');
  const headers = { 'Idempotency-Key': 'export-once' };
  const created = await invokeV2(create, owner.token, 'POST', '/reports/exports', {}, body, headers);
  expect(created.status, await created.clone().text()).toBe(201);
  const id = (await created.json()).data.id as string;
  expect((await invokeV2(create, owner.token, 'POST', '/reports/exports', {}, body, headers)).headers.get('idempotency-replayed')).toBe('true');
  expect(await db.reportExport.count()).toBe(1);
  await db.backgroundJob.updateMany({ where: { type: 'REPORT_EXPORT' }, data: { maxAttempts: 1 } });
  const processed = await processPendingJobsByType('REPORT_EXPORT', 1, 1);
  expect(processed, JSON.stringify(await db.backgroundJob.findMany({ where: { type: 'REPORT_EXPORT' } }))).toMatchObject({ processed: 1 });
  const path = `/reports/exports/${id}`;
  expect((await (await invokeV2(status, owner.token, 'GET', path, { id })).json()).data.status).toBe('COMPLETED');
  const result = await invokeV2(download, owner.token, 'GET', `${path}/download`, { id });
  expect(result.status, await result.clone().text()).toBe(200);
  expect(result.headers.get('x-content-sha256')).toMatch(/^[0-9a-f]{64}$/);
  const downloaded = Buffer.from(await result.arrayBuffer());
  expect(createHash('sha256').update(downloaded).digest('hex')).toBe(result.headers.get('x-content-sha256'));
  expect(JSON.parse(downloaded.toString('utf8'))).toMatchObject({ metrics: { totalIncidents: 0 } });
  expect((await invokeV2(download, other.token, 'GET', `${path}/download`, { id })).status).toBe(404);
  await db.apiKey.update({ where: { id: owner.key.id }, data: { scopes: ['reports:read'] } });
  expect((await invokeV2(download, owner.token, 'GET', `${path}/download`, { id })).status).toBe(403);
  expect(await db.auditLog.count({ where: { entityType: 'REPORT_EXPORT' } })).toBe(2);
});

it('cancels pending work once, enforces quotas and expires encrypted payloads', async () => {
  const owner = await createV2Credential(['reports:read', 'incidents:read'], 'ADMIN');
  const ids: string[] = [];
  for (let index = 0; index < 2; index++) {
    const created = await invokeV2(create, owner.token, 'POST', '/reports/exports', {}, body, { 'Idempotency-Key': `create-${index}` });
    expect(created.status).toBe(201);
    ids.push((await created.json()).data.id);
  }
  expect((await invokeV2(create, owner.token, 'POST', '/reports/exports', {}, body, { 'Idempotency-Key': 'over-quota' })).status).toBe(429);
  const path = `/reports/exports/${ids[0]}/cancel`;
  for (const key of ['cancel-1', 'cancel-2']) {
    expect((await invokeV2(cancel, owner.token, 'POST', path, { id: ids[0] }, undefined, { 'Idempotency-Key': key })).status).toBe(200);
  }
  expect(await db.auditLog.count({ where: { action: 'report.export.cancelled' } })).toBe(1);
  await db.backgroundJob.updateMany({ where: { type: 'REPORT_EXPORT', status: 'PENDING' }, data: { maxAttempts: 1 } });
  const processed = await processPendingJobsByType('REPORT_EXPORT', 2, 1);
  expect(processed, JSON.stringify(await db.backgroundJob.findMany({ where: { type: 'REPORT_EXPORT' } }))).toMatchObject({ processed: 1 });
  expect((await invokeV2(cancel, owner.token, 'POST', `/reports/exports/${ids[1]}/cancel`, { id: ids[1] }, undefined, { 'Idempotency-Key': 'late' })).status).toBe(409);
  await db.reportExport.update({ where: { id: ids[1] }, data: { expiresAt: new Date(Date.now() - 1000) } });
  expect((await expireDueReportExports()).count).toBe(1);
  expect((await invokeV2(download, owner.token, 'GET', `/reports/exports/${ids[1]}/download`, { id: ids[1] })).status).toBe(404);
});

it('does not render an export after its originating credential loses incident scope', async () => {
  const owner = await createV2Credential(['reports:read', 'incidents:read'], 'ADMIN');
  const created = await invokeV2(create, owner.token, 'POST', '/reports/exports', {}, body, {
    'Idempotency-Key': 'credential-revoked-before-worker',
  });
  expect(created.status).toBe(201);
  const id = (await created.json()).data.id as string;
  await db.backgroundJob.updateMany({ where: { type: 'REPORT_EXPORT' }, data: { maxAttempts: 1 } });
  await db.apiKey.update({ where: { id: owner.key.id }, data: { scopes: ['reports:read'] } });
  expect((await processPendingJobsByType('REPORT_EXPORT', 1, 1)).failed).toBe(1);
  expect((await db.reportExport.findUniqueOrThrow({ where: { id } })).encryptedPayload).toBeNull();
  expect((await db.backgroundJob.findFirstOrThrow({ where: { type: 'REPORT_EXPORT' } })).status).toBe('FAILED');
});
