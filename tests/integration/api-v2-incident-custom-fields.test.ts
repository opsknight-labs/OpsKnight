import { beforeEach, expect, it } from 'vitest';
import { GET as list } from '@/app/api/v2/incidents/[id]/custom-fields/route';
import { GET as read, PUT as write } from '@/app/api/v2/incidents/[id]/custom-fields/[fieldId]/route';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import { createTestIncident, createTestService, resetDatabase, testPrisma as db } from '../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
});

it('validates and updates once across idempotency keys without recording private values in audit', async () => {
  const credential = await createV2Credential(['incidents:read', 'incidents:write']);
  const service = await createTestService('Custom fields API');
  const incident = await createTestIncident('Custom field incident', service.id);
  const field = await db.customField.create({ data: { name: 'Customer email', key: 'customer_email', type: 'EMAIL' } });
  const path = `/incidents/${incident.id}/custom-fields/${field.id}`;
  const put = (key: string, value: unknown) => invokeV2(write, credential.token, 'PUT', path, { id: incident.id, fieldId: field.id }, { value }, { 'Idempotency-Key': key });
  expect((await put('bad-value', 'invalid')).status).toBe(400);
  const first = await put('first-value', ' Customer@Example.com ');
  expect(first.status).toBe(200);
  expect((await first.json()).data).toMatchObject({ value: 'customer@example.com', changed: true });
  expect((await (await put('same-value', 'customer@example.com')).json()).data.changed).toBe(false);
  const concurrent = await Promise.all([
    put('concurrent-a', 'customer@example.com'),
    put('concurrent-b', 'customer@example.com'),
  ]);
  expect(concurrent.map(response => response.status)).toEqual([200, 200]);
  expect((await (await invokeV2(read, credential.token, 'GET', path, { id: incident.id, fieldId: field.id })).json()).data.value).toBe('customer@example.com');
  expect((await invokeV2(list, credential.token, 'GET', `/incidents/${incident.id}/custom-fields`, { id: incident.id })).status).toBe(200);
  expect(await db.incidentEvent.count({ where: { incidentId: incident.id, message: { contains: 'Custom field' } } })).toBe(1);
  const audits = await db.auditLog.findMany({ where: { action: 'incident.custom_field.updated' } });
  expect(audits).toHaveLength(1);
  expect(JSON.stringify(audits)).not.toContain('customer@example.com');
});

it('requires write scope and incident visibility', async () => {
  const readOnly = await createV2Credential(['incidents:read']);
  const service = await createTestService('Custom fields permissions');
  const incident = await createTestIncident('Private custom field', service.id);
  const field = await db.customField.create({ data: { name: 'Impact', key: 'impact', type: 'TEXT' } });
  const response = await invokeV2(write, readOnly.token, 'PUT', `/incidents/${incident.id}/custom-fields/${field.id}`, { id: incident.id, fieldId: field.id }, { value: 'hidden' }, { 'Idempotency-Key': 'readonly-denied' });
  expect(response.status).toBe(403);
  expect(await db.customFieldValue.count()).toBe(0);
});
