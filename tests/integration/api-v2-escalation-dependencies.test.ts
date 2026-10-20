import { beforeEach, expect, it } from 'vitest';
import { GET } from '@/app/api/v2/escalation-policies/[id]/dependencies/route';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import { createTestEscalationPolicy, createTestService, createTestUser, resetDatabase } from '../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) {
    throw new Error('Dedicated test DB required');
  }
  await resetDatabase();
});

it('reports service usage and live step targets for deletion and validation', async () => {
  const reader = await createV2Credential(['escalation-policies:read']);
  const user = await createTestUser({ role: 'RESPONDER' });
  const policy = await createTestEscalationPolicy('dependencies', [
    { stepOrder: 0, targetType: 'USER', targetUserId: user.id, delayMinutes: 0 },
  ]);
  const service = await createTestService('Escalation dependency', null, { escalationPolicyId: policy.id });
  const path = `/escalation-policies/${policy.id}/dependencies`;
  const response = await invokeV2(GET, reader.token, 'GET', path, { id: policy.id });
  expect(response.status).toBe(200);
  const data = (await response.json()).data;
  expect(data).toMatchObject({
    policyId: policy.id,
    valid: true,
    deletionAllowed: false,
    services: [{ id: service.id }],
    targets: [{ targetType: 'USER', targetId: user.id, exists: true }],
  });
  expect(response.headers.get('cache-control')).toBe('no-store');
});

it('denies credentials without escalation read permission', async () => {
  const other = await createV2Credential(['services:read']);
  const policy = await createTestEscalationPolicy('restricted dependencies', []);
  const response = await invokeV2(GET, other.token, 'GET', `/escalation-policies/${policy.id}/dependencies`, { id: policy.id });
  expect(response.status).toBe(403);
});
