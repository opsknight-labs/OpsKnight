import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import {
  testPrisma as db,
  resetDatabase,
  createTestService,
  createTestTeam,
} from '../helpers/test-db';
import { clearRetentionPolicyCache } from '@/lib/retention-policy';
import { GET as list, POST as create } from '@/app/api/v2/service-objectives/route';
import { GET as read, PATCH as update } from '@/app/api/v2/service-objectives/[id]/route';
import { POST as archive } from '@/app/api/v2/service-objectives/[id]/archive/route';
import { GET as versions } from '@/app/api/v2/service-objectives/[id]/versions/route';
import { GET as snapshots } from '@/app/api/v2/service-objectives/[id]/snapshots/route';
import { GET as history } from '@/app/api/v2/service-objectives/[id]/history/route';
import { GET as catalog } from '@/app/api/v2/service-objectives/catalog/route';
import { POST as evaluate } from '@/app/api/v2/service-objectives/[id]/evaluate/route';
import { GET as getEvaluation } from '@/app/api/v2/service-objectives/[id]/evaluations/[evaluationId]/route';
import { processJob } from '@/lib/jobs/queue';
import { processObjectiveEvaluation } from '@/lib/slo/evaluation-jobs';
import * as objectiveEvaluator from '@/lib/slo/evaluator';
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
const legacyAuth = vi.hoisted(() => ({ id: '' }));
vi.mock('@/lib/rbac', () => ({
  assertAdmin: async () => ({ id: legacyAuth.id }),
  getCurrentAuthorizationActor: async () => ({
    id: legacyAuth.id,
    role: 'ADMIN',
    status: 'ACTIVE',
    teamIds: [],
  }),
}));
beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
  clearRetentionPolicyCache();
});
const allScopes = [
  'service-objectives:read',
  'service-objectives:write',
  'service-objectives:evaluate',
];
const headers = (revision: number, key = crypto.randomUUID()) => ({
  'If-Match': `"${revision}"`,
  'Idempotency-Key': key,
});
async function fixture() {
  const credential = await createV2Credential(allScopes);
  legacyAuth.id = credential.user.id;
  const service = await createTestService('Objective service');
  const definition = {
    serviceId: service.id,
    name: 'Availability goal',
    metricType: 'UPTIME',
    target: 99.9,
    comparator: 'GREATER_THAN_OR_EQUAL',
    windowType: 'SEVEN_DAYS',
  };
  const response = await invokeV2(
    create,
    credential.token,
    'POST',
    '/service-objectives',
    {},
    { definition, expectedActiveVersionId: null },
    { 'Idempotency-Key': crypto.randomUUID() }
  );
  expect(response.status).toBe(201);
  const objective = (await response.json()).data;
  return {
    credential,
    service,
    definition,
    objective,
    params: { id: objective.id },
    path: `/service-objectives/${objective.id}`,
  };
}
it('publishes an explicit metric contract and preserves immutable version history through edit and archive', async () => {
  const f = await fixture();
  const contract = await invokeV2(
    catalog,
    f.credential.token,
    'GET',
    '/service-objectives/catalog',
    {}
  );
  expect((await contract.json()).data.metrics.map((m: { id: string }) => m.id)).toEqual([
    'UPTIME',
    'AVAILABILITY',
    'MTTA',
    'MTTR',
  ]);
  const before = await invokeV2(read, f.credential.token, 'GET', f.path, f.params);
  expect(before.headers.get('etag')).toBe('"2"');
  const changed = await invokeV2(
    update,
    f.credential.token,
    'PATCH',
    f.path,
    f.params,
    { target: 99.95 },
    headers(2)
  );
  expect(changed.status).toBe(200);
  const next = (await changed.json()).data;
  expect(next).toMatchObject({ version: 2, revision: 4, target: 99.95 });
  expect(
    (await db.serviceObjective.findUniqueOrThrow({ where: { id: f.objective.versionId } })).target
  ).toBe(99.9);
  const listing = await invokeV2(
    versions,
    f.credential.token,
    'GET',
    `${f.path}/versions?limit=1`,
    f.params
  );
  const first = await listing.json();
  expect(first.data[0].version).toBe(2);
  const second = await invokeV2(
    versions,
    f.credential.token,
    'GET',
    `${f.path}/versions?limit=1&cursor=${encodeURIComponent(first.pagination.nextCursor)}`,
    f.params
  );
  expect((await second.json()).data[0].version).toBe(1);
  const closed = await invokeV2(
    archive,
    f.credential.token,
    'POST',
    `${f.path}/archive`,
    f.params,
    {},
    headers(4)
  );
  expect(closed.status).toBe(200);
  expect(closed.headers.get('etag')).toBe('"5"');
  expect((await closed.json()).data.status).toBe('ARCHIVED');
  expect(
    (await (await invokeV2(read, f.credential.token, 'GET', f.path, f.params)).json()).data.revision
  ).toBe(5);
  expect(
    (await (await invokeV2(list, f.credential.token, 'GET', '/service-objectives', {})).json()).data
  ).toHaveLength(0);
  expect(await db.serviceObjective.count()).toBe(2);
});
it('requires explicit slot replacement and replay keys without silently retiring an existing definition', async () => {
  const f = await fixture();
  const request = {
    definition: { ...f.definition, name: 'Replacement' },
    expectedActiveVersionId: null as string | null,
  };
  expect(
    (
      await invokeV2(create, f.credential.token, 'POST', '/service-objectives', {}, request, {
        'Idempotency-Key': 'conflicting-slot',
      })
    ).status
  ).toBe(412);
  request.expectedActiveVersionId = f.objective.versionId;
  const call = () =>
    invokeV2(create, f.credential.token, 'POST', '/service-objectives', {}, request, {
      'Idempotency-Key': 'reviewed-replacement',
    });
  const first = await call();
  expect(first.status).toBe(201);
  const newId = (await first.json()).data.id;
  expect(newId).not.toBe(f.objective.id);
  const replay = await call();
  expect(replay.headers.get('idempotency-replayed')).toBe('true');
  expect((await replay.json()).data.id).toBe(newId);
  expect(await db.serviceObjective.count()).toBe(2);
});
it('rejects unknown fields, unsupported metrics, stale validators and invalid merged windows', async () => {
  const f = await fixture();
  expect(
    (
      await invokeV2(
        update,
        f.credential.token,
        'PATCH',
        f.path,
        f.params,
        { metricType: 'MTTR' },
        headers(2)
      )
    ).status
  ).toBe(400);
  expect(
    (
      await invokeV2(
        update,
        f.credential.token,
        'PATCH',
        f.path,
        f.params,
        { windowType: 'ROLLING_DAYS' },
        headers(2)
      )
    ).status
  ).toBe(400);
  expect(
    (
      await invokeV2(
        update,
        f.credential.token,
        'PATCH',
        f.path,
        f.params,
        { target: 101 },
        headers(2)
      )
    ).status
  ).toBe(400);
  expect(
    (
      await invokeV2(
        update,
        f.credential.token,
        'PATCH',
        f.path,
        f.params,
        { target: 99 },
        { 'If-Match': '"2"' }
      )
    ).status
  ).toBe(400);
  expect(
    (
      await invokeV2(
        update,
        f.credential.token,
        'PATCH',
        f.path,
        f.params,
        { target: 99 },
        { 'Idempotency-Key': 'missing-revision' }
      )
    ).status
  ).toBe(428);
  expect(
    (
      await invokeV2(
        update,
        f.credential.token,
        'PATCH',
        f.path,
        f.params,
        { target: 99 },
        headers(0)
      )
    ).status
  ).toBe(412);
  expect(
    (
      await invokeV2(
        create,
        f.credential.token,
        'POST',
        '/service-objectives',
        {},
        {
          definition: { ...f.definition, metricType: 'ERROR_RATE' },
          expectedActiveVersionId: null,
        },
        { 'Idempotency-Key': 'unsupported' }
      )
    ).status
  ).toBe(400);
});
it('serializes competing edits and attributes exactly one business audit to the credential', async () => {
  const f = await fixture();
  const responses = await Promise.all(
    [99, 98].map(target =>
      invokeV2(update, f.credential.token, 'PATCH', f.path, f.params, { target }, headers(2))
    )
  );
  expect(responses.map(r => r.status).sort()).toEqual([200, 412]);
  expect(await db.serviceObjective.count()).toBe(2);
  const audits = await db.auditLog.findMany({ where: { action: 'service_objective.updated' } });
  expect(audits).toHaveLength(1);
  expect(audits[0].details).toMatchObject({
    source: 'API',
    metadata: { apiClientId: f.credential.key.id },
  });
});
it.each(['RESPONDER', 'AUDITOR', 'USER'] as const)(
  'denies %s definition writes despite a requested write scope',
  async role => {
    const f = await fixture();
    const key = await createV2Credential(allScopes, role);
    expect(
      (await invokeV2(update, key.token, 'PATCH', f.path, f.params, { target: 98 }, headers(2)))
        .status
    ).toBe(403);
  }
);
it('restricts scoped users to authorized service definitions and hides workspace objectives', async () => {
  const f = await fixture();
  const member = await createV2Credential(allScopes, 'USER');
  const team = await createTestTeam('Scoped objective readers');
  await db.teamMember.create({ data: { teamId: team.id, userId: member.user.id, role: 'MEMBER' } });
  await db.service.update({ where: { id: f.service.id }, data: { teamId: team.id } });
  const scoped = await invokeV2(read, member.token, 'GET', f.path, f.params);
  expect(scoped.status, await scoped.clone().text()).toBe(200);
  const stranger = await createV2Credential(allScopes, 'USER');
  expect((await invokeV2(read, stranger.token, 'GET', f.path, f.params)).status).toBe(404);
  expect(
    (await invokeV2(snapshots, member.token, 'GET', `${f.path}/snapshots`, f.params)).status
  ).toBe(403);
  expect(
    (await (await invokeV2(list, stranger.token, 'GET', '/service-objectives', {})).json()).data
  ).toHaveLength(0);
  const workspace = await invokeV2(
    create,
    f.credential.token,
    'POST',
    '/service-objectives',
    {},
    {
      definition: {
        name: 'Workspace MTTR',
        metricType: 'MTTR',
        target: 30,
        comparator: 'LESS_THAN_OR_EQUAL',
        windowType: 'SEVEN_DAYS',
      },
      expectedActiveVersionId: null,
    },
    { 'Idempotency-Key': 'workspace' }
  );
  expect(workspace.status).toBe(201);
  const id = (await workspace.json()).data.id;
  expect(
    (await invokeV2(read, member.token, 'GET', `/service-objectives/${id}`, { id })).status
  ).toBe(404);
});
it('shares the versioned write command with the existing session-authenticated management API', async () => {
  const f = await fixture();
  const { PATCH } = await import('@/app/api/v1/service-objectives/[id]/route');
  const response = await PATCH(
    new NextRequest(`http://localhost/api/v1/service-objectives/${f.objective.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 99.8 }),
    }),
    { params: Promise.resolve(f.params) }
  );
  expect(response.status).toBe(200);
  const current = await invokeV2(read, f.credential.token, 'GET', f.path, f.params);
  expect((await current.json()).data).toMatchObject({ revision: 4, target: 99.8 });
  const audit = await db.auditLog.findFirstOrThrow({
    where: { action: 'service_objective.updated' },
  });
  expect(audit.details).toMatchObject({ source: 'UI' });
});
it('accepts one durable evaluation and exposes a real queue result without overwriting shared daily history', async () => {
  const f = await fixture();
  const body = { expectedVersionId: f.objective.versionId };
  const key = { 'Idempotency-Key': 'evaluate-once' };
  const call = () =>
    invokeV2(evaluate, f.credential.token, 'POST', `${f.path}/evaluate`, f.params, body, key);
  const response = await call();
  expect(response.status).toBe(202);
  const job = (await response.json()).data;
  expect(job.status).toBe('PENDING');
  expect((await call()).headers.get('idempotency-replayed')).toBe('true');
  const processed = await processJob(job.id);
  expect(
    processed,
    (await db.backgroundJob.findUniqueOrThrow({ where: { id: job.id } })).error ?? ''
  ).toBe(true);
  const result = await invokeV2(
    getEvaluation,
    f.credential.token,
    'GET',
    `${f.path}/evaluations/${job.id}`,
    { ...f.params, evaluationId: job.id }
  );
  expect(result.status).toBe(200);
  expect((await result.json()).data).toMatchObject({
    status: 'COMPLETED',
    result: {
      outcome: 'EVALUATED',
      evaluation: { value: 100, definitionVersion: 1, dataState: 'AVAILABLE' },
    },
  });
  await processObjectiveEvaluation(job.id);
  expect(
    await db.auditLog.count({ where: { action: 'service_objective.evaluation.completed' } })
  ).toBe(1);
  expect(await db.serviceObjectiveSnapshot.count()).toBe(0);
});
it('enforces evaluation admission and rechecks revocation before computing or disclosing results', async () => {
  const f = await fixture();
  const calls = [];
  for (let i = 0; i < 2; i++)
    calls.push(
      await invokeV2(
        evaluate,
        f.credential.token,
        'POST',
        `${f.path}/evaluate`,
        f.params,
        { expectedVersionId: f.objective.versionId },
        { 'Idempotency-Key': `capacity-${i}` }
      )
    );
  expect(calls.map(r => r.status)).toEqual([202, 202]);
  expect(
    (
      await invokeV2(
        evaluate,
        f.credential.token,
        'POST',
        `${f.path}/evaluate`,
        f.params,
        { expectedVersionId: f.objective.versionId },
        { 'Idempotency-Key': 'capacity-overflow' }
      )
    ).status
  ).toBe(429);
  const job = (await calls[0].json()).data;
  await db.apiKey.update({ where: { id: f.credential.key.id }, data: { revokedAt: new Date() } });
  expect(await processJob(job.id)).toBe(true);
  const stored = await db.backgroundJob.findUniqueOrThrow({ where: { id: job.id } });
  expect(stored.payload).toMatchObject({ receipt: { outcome: 'ACCESS_REVOKED' } });
  expect(stored.payload).not.toHaveProperty('receipt.evaluation');
});
it('preserves snapshot precision and binds signed history cursors to the correct lineage', async () => {
  const f = await fixture();
  await db.serviceObjectiveSnapshot.create({
    data: {
      objectiveId: f.objective.versionId,
      periodStart: new Date(Date.now() - 86400000),
      periodEnd: new Date(),
      value: 99.9,
      numerator: BigInt('9007199254740993'),
      sampleCount: BigInt('9007199254740993'),
      target: 99.9,
      dataState: 'AVAILABLE',
      definitionVersion: 1,
    },
  });
  const response = await invokeV2(
    snapshots,
    f.credential.token,
    'GET',
    `${f.path}/snapshots`,
    f.params
  );
  expect((await response.json()).data[0]).toMatchObject({
    numerator: '9007199254740993',
    sampleCount: '9007199254740993',
  });
  expect(
    (
      await invokeV2(
        history,
        f.credential.token,
        'GET',
        `${f.path}/history?source=LEGACY_INCIDENT_SLA`,
        f.params
      )
    ).status
  ).toBe(200);
  const values = await invokeV2(
    versions,
    f.credential.token,
    'GET',
    `${f.path}/versions?limit=1`,
    f.params
  );
  expect(values.status).toBe(200);
  await invokeV2(
    update,
    f.credential.token,
    'PATCH',
    f.path,
    f.params,
    { target: 99.8 },
    headers(2)
  );
  const paged = await (
    await invokeV2(versions, f.credential.token, 'GET', `${f.path}/versions?limit=1`, f.params)
  ).json();
  const other = await fixture();
  expect(
    (
      await invokeV2(
        versions,
        other.credential.token,
        'GET',
        `${other.path}/versions?limit=1&cursor=${encodeURIComponent(paged.pagination.nextCursor)}`,
        other.params
      )
    ).status
  ).toBe(400);
});

it('serializes concurrent evaluation admission across distinct idempotency keys', async () => {
  const f = await fixture();
  const responses = await Promise.all(
    Array.from({ length: 3 }, (_, index) =>
      invokeV2(
        evaluate,
        f.credential.token,
        'POST',
        `${f.path}/evaluate`,
        f.params,
        { expectedVersionId: f.objective.versionId },
        { 'Idempotency-Key': `concurrent-admission-${index}` }
      )
    )
  );
  expect(responses.map(response => response.status).sort()).toEqual([202, 202, 429]);
  expect(
    await db.backgroundJob.count({
      where: { payload: { path: ['task'], equals: 'SERVICE_OBJECTIVE_EVALUATE' } },
    })
  ).toBe(2);
  expect(
    await db.auditLog.count({ where: { action: 'service_objective.evaluation.requested' } })
  ).toBe(2);
});
it('discards an evaluation when its credential is revoked during computation', async () => {
  const f = await fixture();
  const response = await invokeV2(
    evaluate,
    f.credential.token,
    'POST',
    `${f.path}/evaluate`,
    f.params,
    { expectedVersionId: f.objective.versionId },
    { 'Idempotency-Key': 'mid-computation-revocation' }
  );
  expect(response.status).toBe(202);
  const job = (await response.json()).data;
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>(resolve => {
    enter = resolve;
  });
  const blocked = new Promise<void>(resolve => {
    release = resolve;
  });
  const original = objectiveEvaluator.evaluateServiceObjective;
  const spy = vi
    .spyOn(objectiveEvaluator, 'evaluateServiceObjective')
    .mockImplementation(async input => {
      enter();
      await blocked;
      return original(input);
    });
  const processing = processJob(job.id);
  try {
    await entered;
    await db.apiKey.update({ where: { id: f.credential.key.id }, data: { revokedAt: new Date() } });
    release();
    expect(await processing).toBe(true);
    const stored = await db.backgroundJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(stored.payload).toMatchObject({ receipt: { outcome: 'ACCESS_REVOKED' } });
    expect(stored.payload).not.toHaveProperty('receipt.evaluation');
    expect(
      await db.auditLog.count({ where: { action: 'service_objective.evaluation.completed' } })
    ).toBe(1);
  } finally {
    release();
    await processing;
    spy.mockRestore();
  }
});
it('rejects stale worker claims before computing or persisting an evaluation', async () => {
  const f = await fixture();
  const response = await invokeV2(
    evaluate,
    f.credential.token,
    'POST',
    `${f.path}/evaluate`,
    f.params,
    { expectedVersionId: f.objective.versionId },
    { 'Idempotency-Key': 'stale-claim' }
  );
  const job = (await response.json()).data;
  await db.backgroundJob.update({
    where: { id: job.id },
    data: { status: 'PROCESSING', claimToken: 'b73d98dc-0d61-4d35-b913-31a47905c427' },
  });
  await expect(
    processObjectiveEvaluation(job.id, '8d536617-eef1-4b49-bd44-5ebfe4428d15')
  ).rejects.toThrow('claim');
  expect(
    (await db.backgroundJob.findUniqueOrThrow({ where: { id: job.id } })).payload
  ).not.toHaveProperty('receipt');
  expect(
    await db.auditLog.count({ where: { action: 'service_objective.evaluation.completed' } })
  ).toBe(0);
});

it('shares UI mutation commands with REST and rejects a stale form without losing history', async () => {
  const f = await fixture();
  const { saveObjective } = await import('@/app/(app)/settings/service-objectives/actions');
  const form = new FormData();
  Object.entries({
    operation: 'update',
    id: f.objective.id,
    version: '1',
    name: 'UI edited objective',
    description: 'Reviewed definition',
    target: '99.95',
    comparator: 'GREATER_THAN_OR_EQUAL',
    windowType: 'SEVEN_DAYS',
    windowValue: '7',
  }).forEach(([key, value]) => form.set(key, value));
  const previous = { message: '', ok: false };
  expect(await saveObjective(previous, form)).toMatchObject({ ok: true });
  expect(await saveObjective(previous, form)).toMatchObject({ ok: false });
  const latest = await invokeV2(read, f.credential.token, 'GET', f.path, f.params);
  expect((await latest.json()).data).toMatchObject({ name: 'UI edited objective', revision: 4 });
  expect(await db.serviceObjective.count({ where: { lineageId: f.objective.id } })).toBe(2);
  const retirement = new FormData();
  Object.entries({ operation: 'archive', id: f.objective.id, version: '2' }).forEach(
    ([key, value]) => retirement.set(key, value)
  );
  expect(await saveObjective(previous, retirement)).toMatchObject({ ok: true });
  expect(await db.serviceObjective.count({ where: { lineageId: f.objective.id } })).toBe(2);
  expect(
    await db.auditLog.count({
      where: { action: 'service_objective.updated', details: { path: ['source'], equals: 'UI' } },
    })
  ).toBe(1);
});

it('withholds a formerly global evaluation after the owner becomes a scoped service reader', async () => {
  const f = await fixture();
  const team = await createTestTeam('Evaluation audience');
  await db.teamMember.create({
    data: { teamId: team.id, userId: f.credential.user.id, role: 'MEMBER' },
  });
  await db.service.update({ where: { id: f.service.id }, data: { teamId: team.id } });
  const response = await invokeV2(
    evaluate,
    f.credential.token,
    'POST',
    `${f.path}/evaluate`,
    f.params,
    { expectedVersionId: f.objective.versionId },
    { 'Idempotency-Key': 'former-global-reader' }
  );
  expect(response.status).toBe(202);
  const job = (await response.json()).data;
  expect(await processJob(job.id)).toBe(true);
  await db.user.update({ where: { id: f.credential.user.id }, data: { role: 'USER' } });
  expect((await invokeV2(read, f.credential.token, 'GET', f.path, f.params)).status).toBe(200);
  expect(
    (
      await invokeV2(getEvaluation, f.credential.token, 'GET', `${f.path}/evaluations/${job.id}`, {
        ...f.params,
        evaluationId: job.id,
      })
    ).status
  ).toBe(404);
});

it('evaluates real MTTA samples using captured SLA time rather than rounded means or the whole incident cohort', async () => {
  const f = await fixture();
  const goalResponse = await invokeV2(
    create,
    f.credential.token,
    'POST',
    '/service-objectives',
    {},
    {
      definition: {
        ...f.definition,
        metricType: 'MTTA',
        target: 30,
        comparator: 'LESS_THAN_OR_EQUAL',
      },
      expectedActiveVersionId: null,
    },
    { 'Idempotency-Key': 'real-mtta-definition' }
  );
  expect(goalResponse.status).toBe(201);
  const goal = (await goalResponse.json()).data;
  const now = Date.now();
  await db.incident.create({
    data: {
      title: 'Measured acknowledgement',
      serviceId: f.service.id,
      status: 'ACKNOWLEDGED',
      createdAt: new Date(now - 90 * 60000),
      acknowledgedAt: new Date(now - 30 * 60000),
      slaAckElapsedMs: BigInt(1800001),
    },
  });
  await db.incident.create({
    data: {
      title: 'No acknowledgement sample',
      serviceId: f.service.id,
      status: 'OPEN',
      createdAt: new Date(now - 80 * 60000),
    },
  });
  const accepted = await invokeV2(
    evaluate,
    f.credential.token,
    'POST',
    `/service-objectives/${goal.id}/evaluate`,
    { id: goal.id },
    {
      expectedVersionId: goal.versionId,
      start: new Date(now - 120 * 60000).toISOString(),
      end: new Date(now).toISOString(),
    },
    { 'Idempotency-Key': 'real-mtta-evaluation' }
  );
  expect(accepted.status).toBe(202);
  const job = (await accepted.json()).data;
  expect(await processJob(job.id)).toBe(true);
  const result = await invokeV2(
    getEvaluation,
    f.credential.token,
    'GET',
    `/service-objectives/${goal.id}/evaluations/${job.id}`,
    { id: goal.id, evaluationId: job.id }
  );
  const recorded = (await result.json()).data.result.evaluation;
  expect(recorded).toMatchObject({
    dataState: 'AVAILABLE',
    sampleCount: 1,
    sampleCountExact: '1',
    elapsedSumMs: '1800001',
    compliant: false,
    breached: true,
  });
  expect(recorded.value).toBeGreaterThan(30);
});
