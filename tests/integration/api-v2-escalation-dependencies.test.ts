import { beforeEach, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/v2/escalation-policies/[id]/dependencies/route';
import { GET as GET_VALIDATION } from '@/app/api/v2/escalation-policies/[id]/validation/route';
import { DELETE } from '@/app/api/v2/escalation-policies/[id]/route';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import { createTestEscalationPolicy, createTestService, createTestUser, resetDatabase, testPrisma } from '../helpers/test-db';
import { emptySnapshot } from '@/lib/automation/contract';
import { saveDraft, publishVersion } from '@/lib/automation/versioning';

function deletePolicy(token: string, id: string) {
  return DELETE(new NextRequest(`http://localhost/api/v2/escalation-policies/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  }), { params: Promise.resolve({ id }) });
}

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
    usage: { services: 1, versionRefs: 0, decisions: 0 },
    truncated: { services: false, targets: false },
    services: [{ id: service.id }],
    targets: [{ targetType: 'USER', targetId: user.id, exists: true }],
  });
  expect(response.headers.get('cache-control')).toBe('no-store');
});

it('blocks deletion while a service references the policy and allows it after reassignment', async () => {
  const manager = await createV2Credential(['escalation-policies:write', 'escalation-policies:read']);
  const policy = await createTestEscalationPolicy('deletion safety', []);
  const service = await createTestService('Deletion safety service', null, { escalationPolicyId: policy.id });
  const path = `/escalation-policies/${policy.id}`;
  expect((await deletePolicy(manager.token, policy.id)).status).toBe(409);
  expect(await testPrisma.escalationPolicy.findUnique({ where: { id: policy.id } })).not.toBeNull();
  await testPrisma.service.update({ where: { id: service.id }, data: { escalationPolicyId: null } });
  const snapshot = await invokeV2(GET, manager.token, 'GET', `${path}/dependencies`, { id: policy.id });
  expect((await snapshot.json()).data).toMatchObject({ deletionAllowed: true, usage: { services: 0 } });
  expect((await deletePolicy(manager.token, policy.id)).status).toBe(200);
  expect(await testPrisma.escalationPolicy.findUnique({ where: { id: policy.id } })).toBeNull();
});

it('serializes deletion with a concurrent service assignment', async () => {
  const manager = await createV2Credential(['escalation-policies:write']);
  const policy = await createTestEscalationPolicy('concurrent assignment', []);
  const service = await createTestService('Concurrent assignment service');
  let releaseAssignment!: () => void;
  let assignmentReady!: () => void;
  const release = new Promise<void>(resolve => { releaseAssignment = resolve; });
  const ready = new Promise<void>(resolve => { assignmentReady = resolve; });
  const assignment = testPrisma.$transaction(async tx => {
    await tx.service.update({ where: { id: service.id }, data: { escalationPolicyId: policy.id } });
    assignmentReady();
    await release;
  }, { timeout: 10_000 });
  await ready;
  const deletion = deletePolicy(manager.token, policy.id);
  try {
    await new Promise(resolve => setTimeout(resolve, 100));
  } finally {
    releaseAssignment();
  }
  await assignment;
  expect((await deletion).status).toBe(409);
  expect((await testPrisma.service.findUnique({ where: { id: service.id } }))?.escalationPolicyId).toBe(policy.id);
}, 15_000);

it('keeps a policy protected after its service is reassigned when published automation still references it', async () => {
  const manager = await createV2Credential(['escalation-policies:read', 'escalation-policies:write']);
  const policy = await createTestEscalationPolicy('historical reference', []);
  const service = await createTestService('Historical policy service', null, { escalationPolicyId: policy.id });
  const draft = await saveDraft({
    serviceId: service.id,
    actorId: manager.user.id,
    snapshot: {
      ...emptySnapshot,
      rules: [{
        id: 'route-history', name: 'Historical route', phase: 'ROUTE', enabled: true,
        conditions: [], actions: [{ type: 'USE_ESCALATION_POLICY', policyId: policy.id }],
      }],
    },
    expectedRevision: 0,
  });
  await publishVersion({
    serviceId: service.id,
    actorId: manager.user.id,
    expectedRevision: draft.revision,
    expectedActiveVersionId: null,
  });
  await testPrisma.service.update({ where: { id: service.id }, data: { escalationPolicyId: null } });
  const response = await invokeV2(GET, manager.token, 'GET', `/escalation-policies/${policy.id}/dependencies`, { id: policy.id });
  expect((await response.json()).data).toMatchObject({ deletionAllowed: false, usage: { services: 0, versionRefs: 1 } });
  expect((await deletePolicy(manager.token, policy.id)).status).toBe(409);
});

it('denies credentials without escalation read permission', async () => {
  const other = await createV2Credential(['services:read']);
  const policy = await createTestEscalationPolicy('restricted dependencies', []);
  const response = await invokeV2(GET, other.token, 'GET', `/escalation-policies/${policy.id}/dependencies`, { id: policy.id });
  expect(response.status).toBe(403);
  const validation = await invokeV2(GET_VALIDATION, other.token, 'GET', `/escalation-policies/${policy.id}/validation`, { id: policy.id });
  expect(validation.status).toBe(403);
});

it('reports actionable stored-policy issues without mutating the policy', async () => {
  const reader = await createV2Credential(['escalation-policies:read']);
  const user = await createTestUser({ role: 'RESPONDER' });
  const policy = await createTestEscalationPolicy('validation', [
    { stepOrder: 0, targetType: 'USER', targetUserId: user.id, delayMinutes: 0 },
  ]);
  const path = `/escalation-policies/${policy.id}/validation`;
  const initial = await invokeV2(GET_VALIDATION, reader.token, 'GET', path, { id: policy.id });
  expect(initial.status).toBe(200);
  expect((await initial.json()).data).toMatchObject({ policyId: policy.id, valid: true, issues: [], truncated: false });
  await testPrisma.user.update({ where: { id: user.id }, data: { status: 'DISABLED' } });
  const invalid = await invokeV2(GET_VALIDATION, reader.token, 'GET', path, { id: policy.id });
  expect(invalid.status).toBe(200);
  expect((await invalid.json()).data).toMatchObject({
    valid: false, issues: [{ code: 'TARGET_UNAVAILABLE', field: 'targetId' }],
  });
  expect(invalid.headers.get('cache-control')).toBe('no-store');
});

it('rejects empty and archived policies in the validation snapshot', async () => {
  const reader = await createV2Credential(['escalation-policies:read']);
  const policy = await createTestEscalationPolicy('empty validation', []);
  const path = `/escalation-policies/${policy.id}/validation`;
  const empty = await invokeV2(GET_VALIDATION, reader.token, 'GET', path, { id: policy.id });
  expect((await empty.json()).data).toMatchObject({
    valid: false, issues: [{ code: 'NO_STEPS' }],
  });
  await testPrisma.escalationPolicy.update({ where: { id: policy.id }, data: { archivedAt: new Date() } });
  const archived = await invokeV2(GET_VALIDATION, reader.token, 'GET', path, { id: policy.id });
  const data = (await archived.json()).data;
  expect(data.valid).toBe(false);
  expect(data.issues.map((issue: { code: string }) => issue.code)).toEqual(['ARCHIVED', 'NO_STEPS']);
});
