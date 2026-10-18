import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { getOpenApiV2Spec } from '@/lib/api-v2/openapi';
import { beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { GET as getConfiguration } from '@/app/api/v2/services/[id]/automation/route';
import { PATCH as changeModeRoute } from '@/app/api/v2/services/[id]/automation/mode/route';
import { GET as listVersions } from '@/app/api/v2/services/[id]/automation/versions/route';
import { GET as getVersion } from '@/app/api/v2/services/[id]/automation/versions/[versionId]/route';
import { POST as restoreDraftRoute } from '@/app/api/v2/services/[id]/automation/restore/route';
import { POST as validateRoute } from '@/app/api/v2/services/[id]/automation/validate/route';
import { POST as simulateRoute } from '@/app/api/v2/services/[id]/automation/simulate/route';
import { GET as observationsRoute } from '@/app/api/v2/services/[id]/automation/observations/route';
import { GET as decisionsRoute } from '@/app/api/v2/services/[id]/automation/decisions/route';
import { saveDraft, publishVersion } from '@/lib/automation/versioning';
import { emptySnapshot } from '@/lib/automation/contract';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import { resetDatabase, testPrisma as db, createTestService } from '../helpers/test-db';

const responseValidator = new Ajv2020({ strict: false, allErrors: true });
addFormats(responseValidator);
responseValidator.addSchema({
  $id: 'automation-api-spec',
  components: getOpenApiV2Spec().components,
});
function conformsToSchema(name: string, data: unknown) {
  const validate = responseValidator.getSchema(`automation-api-spec#/components/schemas/${name}`)!;
  expect(validate, name).toBeDefined();
  expect(validate(data), JSON.stringify(validate.errors)).toBe(true);
}

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL!).pathname.endsWith('_test'))
    throw new Error('Isolated test database required');
  await resetDatabase();
  await db.systemSettings.upsert({
    where: { id: 'default' },
    create: { automationEnabled: true },
    update: { automationEnabled: true },
  });
});
async function fixture() {
  const admin = await createV2Credential([
    'automation:read',
    'automation:write',
    'automation:publish',
  ]);
  const service = await createTestService('Lifecycle REST');
  const draft = await saveDraft({
    serviceId: service.id,
    actorId: admin.user.id,
    snapshot: emptySnapshot,
    expectedRevision: 0,
  });
  const version = await publishVersion({
    serviceId: service.id,
    actorId: admin.user.id,
    expectedRevision: draft.revision,
    expectedActiveVersionId: null,
  });
  const params = { id: service.id },
    path = `/services/${service.id}/automation`;
  const read = () => invokeV2(getConfiguration, admin.token, 'GET', path, params);
  const mode = (value: 'DISABLED' | 'SHADOW' | 'LIVE', revision: string, key = randomUUID()) =>
    invokeV2(
      changeModeRoute,
      admin.token,
      'PATCH',
      `${path}/mode`,
      params,
      { mode: value, expectedActiveVersionId: version.id, acknowledgeNoShadow: true },
      { 'If-Match': revision, 'Idempotency-Key': key }
    );
  return { admin, service, version, params, path, read, mode };
}
it('uses the configuration validator and fences UI/database writes and replay', async () => {
  const f = await fixture();
  const initial = await f.read(),
    etag = initial.headers.get('etag')!;
  expect((await initial.json()).data).toMatchObject({
    revision: 2,
    draftRevision: 1,
    activeVersionId: f.version.id,
    mode: 'DISABLED',
    effectiveMode: 'DISABLED',
  });
  conformsToSchema('AutomationConfiguration', (await (await f.read()).json()).data);
  expect(etag).toBe('"2"');
  const key = randomUUID();
  const changed = await f.mode('SHADOW', etag, key);
  expect(changed.status).toBe(200);
  expect(changed.headers.get('etag')).toBe('"3"');
  const replay = await f.mode('SHADOW', '"0"', key);
  expect(replay.status).toBe(200);
  expect(replay.headers.get('idempotency-replayed')).toBe('true');
  expect((await f.mode('LIVE', etag)).status).toBe(412);
  // The trigger advances the same validator even when the API is bypassed by a UI/domain writer.
  await db.serviceAutomationConfig.update({
    where: { serviceId: f.service.id },
    data: { mode: 'DISABLED' },
  });
  expect((await f.read()).headers.get('etag')).toBe('"4"');
  expect((await f.mode('LIVE', '"3"')).status).toBe(412);
  expect(await db.auditLog.count({ where: { action: 'automation.mode.changed' } })).toBe(1);
});
it('gives concurrent writers one winner and preserves global OFF and authorization', async () => {
  const f = await fixture();
  const etag = (await f.read()).headers.get('etag')!;
  const writes = await Promise.all([f.mode('SHADOW', etag), f.mode('DISABLED', etag)]);
  expect(writes.map(response => response.status).sort()).toEqual([200, 412]);
  for (const role of ['ADMIN', 'RESPONDER'] as const) {
    const denied = await createV2Credential(
      role === 'ADMIN' ? ['automation:read'] : ['automation:publish'],
      role
    );
    const response = await invokeV2(
      changeModeRoute,
      denied.token,
      'PATCH',
      `${f.path}/mode`,
      f.params,
      { mode: 'LIVE', expectedActiveVersionId: f.version.id },
      { 'If-Match': '"3"', 'Idempotency-Key': randomUUID() }
    );
    expect(response.status).toBe(403);
  }
  await db.systemSettings.update({ where: { id: 'default' }, data: { automationEnabled: false } });
  const current = await f.read();
  expect((await current.json()).data.effectiveMode).toBe('DISABLED');
  expect((await f.mode('LIVE', current.headers.get('etag')!)).status).toBe(400);
  expect((await f.mode('DISABLED', current.headers.get('etag')!)).status).toBe(200);
});
it('rolls configuration revision, audit and replay back together when audit persistence fails', async () => {
  const f = await fixture(),
    etag = (await f.read()).headers.get('etag')!,
    key = randomUUID();
  await db.$executeRawUnsafe(`CREATE FUNCTION api_v2_mode_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.action = 'automation.mode.changed' THEN RAISE EXCEPTION 'Injected mode audit failure'; END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe(
    'CREATE TRIGGER api_v2_mode_reject_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION api_v2_mode_reject_audit()'
  );
  try {
    const rejected = await f.mode('SHADOW', etag, key);
    expect(rejected.status).toBe(500);
    expect(await rejected.text()).not.toContain('Injected mode audit failure');
    expect((await f.read()).headers.get('etag')).toBe(etag);
    expect(
      await db.serviceAutomationConfig.findUnique({ where: { serviceId: f.service.id } })
    ).toMatchObject({ mode: 'DISABLED' });
    expect(
      await db.backgroundJob.count({
        where: { payload: { path: ['task'], equals: 'IDEMPOTENCY_RECORD' } },
      })
    ).toBe(0);
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER api_v2_mode_reject_audit ON "AuditLog"');
    await db.$executeRawUnsafe('DROP FUNCTION api_v2_mode_reject_audit()');
  }
  expect((await f.mode('SHADOW', etag, key)).status).toBe(200);
  expect(await db.auditLog.count({ where: { action: 'automation.mode.changed' } })).toBe(1);
});

it('restores historical snapshots as fenced editable drafts with lineage and no cutover', async () => {
  const f = await fixture();
  const restore = (revision: string, sourceVersionId = f.version.id, key = randomUUID()) =>
    invokeV2(
      restoreDraftRoute,
      f.admin.token,
      'POST',
      `${f.path}/restore`,
      f.params,
      { sourceVersionId },
      { 'If-Match': revision, 'Idempotency-Key': key }
    );
  const before = await db.serviceAutomationConfig.findUniqueOrThrow({
    where: { serviceId: f.service.id },
  });
  expect((await restore('"0"')).status).toBe(412);
  const key = randomUUID();
  const response = await restore('"1"', f.version.id, key);
  expect(response.status).toBe(200);
  expect(response.headers.get('etag')).toBe('"2"');
  conformsToSchema('AutomationDraft', (await response.clone().json()).data);
  expect((await response.json()).data).toMatchObject({
    revision: 2,
    restoredFromVersionId: f.version.id,
    snapshot: emptySnapshot,
  });
  const replay = await restore('"1"', f.version.id, key);
  expect(replay.headers.get('idempotency-replayed')).toBe('true');
  expect(
    await db.serviceAutomationConfig.findUniqueOrThrow({ where: { serviceId: f.service.id } })
  ).toMatchObject({
    mode: before.mode,
    activeVersionId: before.activeVersionId,
    candidateVersionId: before.candidateVersionId,
  });
  expect(await db.auditLog.count({ where: { action: 'automation.draft.restored' } })).toBe(1);
  const edited = await saveDraft({
    serviceId: f.service.id,
    actorId: f.admin.user.id,
    expectedRevision: 2,
    snapshot: emptySnapshot,
  });
  const published = await publishVersion({
    serviceId: f.service.id,
    actorId: f.admin.user.id,
    expectedRevision: edited.revision,
    expectedActiveVersionId: f.version.id,
  });
  expect(published.sourceVersionId).toBe(f.version.id);
  const foreign = await fixture();
  expect((await restore('"3"', foreign.version.id)).status).toBe(404);
});

it('paginates immutable history without accepting another service cursor or version', async () => {
  const f = await fixture();
  const draft = await saveDraft({
    serviceId: f.service.id,
    actorId: f.admin.user.id,
    expectedRevision: 1,
    snapshot: emptySnapshot,
  });
  const second = await publishVersion({
    serviceId: f.service.id,
    actorId: f.admin.user.id,
    expectedRevision: draft.revision,
    expectedActiveVersionId: f.version.id,
  });
  const read = (path: string) => invokeV2(listVersions, f.admin.token, 'GET', path, f.params);
  const first = await (await read(`${f.path}/versions?limit=1`)).json();
  expect(first.data.map((v: { id: string }) => v.id)).toEqual([second.id]);
  expect(first.pagination.hasMore).toBe(true);
  first.data.forEach((item: unknown) => conformsToSchema('AutomationVersionSummary', item));
  const next = await (
    await read(`${f.path}/versions?limit=1&cursor=${first.pagination.nextCursor}`)
  ).json();
  expect(next.data.map((v: { id: string }) => v.id)).toEqual([f.version.id]);
  expect(next.pagination.hasMore).toBe(false);
  expect((await read(`${f.path}/versions?limit=101`)).status).toBe(400);
  const other = await createTestService('Foreign history');
  expect(
    (
      await invokeV2(
        listVersions,
        f.admin.token,
        'GET',
        `/services/${other.id}/automation/versions?cursor=${first.pagination.nextCursor}`,
        { id: other.id }
      )
    ).status
  ).toBe(400);
  const foreign = await invokeV2(
    getVersion,
    f.admin.token,
    'GET',
    `/services/${other.id}/automation/versions/${f.version.id}`,
    { id: other.id, versionId: f.version.id }
  );
  expect(foreign.status).toBe(404);
  const detail = await invokeV2(
    getVersion,
    f.admin.token,
    'GET',
    `${f.path}/versions/${f.version.id}`,
    { ...f.params, versionId: f.version.id }
  );
  conformsToSchema('AutomationVersionDetail', (await detail.clone().json()).data);
  expect((await detail.json()).data).toMatchObject({ snapshot: emptySnapshot });
});

it('validates and simulates with no persisted operational effects or raw payload diagnostics', async () => {
  const f = await fixture();
  const counts = async () =>
    Promise.all([
      db.incident.count(),
      db.backgroundJob.count(),
      db.auditLog.count(),
      db.automationContextObservation.count(),
    ]);
  const before = await counts();
  const valid = await invokeV2(
    validateRoute,
    f.admin.token,
    'POST',
    `${f.path}/validate`,
    f.params,
    { snapshot: emptySnapshot }
  );
  expect(valid.status).toBe(200);
  conformsToSchema('AutomationValidation', (await valid.clone().json()).data);
  expect((await valid.json()).data).toMatchObject({ valid: true, requiresActivationReview: true });
  const body = {
    snapshot: emptySnapshot,
    integrationType: 'events',
    event: {
      event_action: 'trigger',
      dedup_key: 'test',
      payload: { summary: 'private incident text', source: 'confidential host', severity: 'info' },
    },
    providerPayload: { credential: 'do-not-expose-this' },
  };
  const simulated = await invokeV2(
    simulateRoute,
    f.admin.token,
    'POST',
    `${f.path}/simulate`,
    f.params,
    body
  );
  expect(simulated.status).toBe(200);
  conformsToSchema('AutomationSimulation', (await simulated.clone().json()).data);
  const text = await simulated.text();
  expect(text).not.toContain('private incident text');
  expect(text).not.toContain('confidential host');
  expect(text).not.toContain('do-not-expose-this');
  expect(JSON.parse(text).data.result.outcome).toEqual({ type: 'SERVICE_DEFAULT' });
  expect(await counts()).toEqual(before);
  const unsafe = {
    ...emptySnapshot,
    rules: [
      {
        id: 'unsafe',
        name: 'Unsafe unconditional suppression',
        phase: 'ROUTE',
        enabled: true,
        conditions: [],
        actions: [{ type: 'NO_ESCALATION' }],
      },
    ],
  };
  const invalid = await invokeV2(
    validateRoute,
    f.admin.token,
    'POST',
    `${f.path}/validate`,
    f.params,
    { snapshot: unsafe }
  );
  expect((await invalid.json()).data).toMatchObject({
    valid: false,
    issues: expect.arrayContaining([expect.objectContaining({ code: 'CATCH_ALL_NO_ESCALATION' })]),
  });
  const rejectedSimulation = await invokeV2(
    simulateRoute,
    f.admin.token,
    'POST',
    `${f.path}/simulate`,
    f.params,
    { ...body, snapshot: unsafe }
  );
  expect((await rejectedSimulation.json()).data).toMatchObject({ valid: false, result: null });
  expect(await counts()).toEqual(before);

  const integration = await db.integration.create({
    data: {
      name: 'Foreign',
      type: 'webhook',
      key: randomUUID(),
      serviceId: (await createTestService('Other')).id,
    },
  });
  expect(
    (
      await invokeV2(simulateRoute, f.admin.token, 'POST', `${f.path}/simulate`, f.params, {
        ...body,
        integrationId: integration.id,
      })
    ).status
  ).toBe(400);
});

it('returns bounded observation metadata without values and separately gates incident decision access', async () => {
  const f = await fixture();
  for (let i = 0; i < 3; i++)
    await db.automationContextObservation.create({
      data: {
        serviceId: f.service.id,
        integrationId: 'fixture',
        integrationType: 'events',
        fieldKey: `field_${i}`,
        sourcePath: `payload.field_${i}`,
        fieldType: 'STRING',
        normalizedRawValueHash: `sensitive-hash-${i}`,
        rawValuePreview: 'private-observed-value',
        unmapped: i < 2,
      },
    });
  const response = await invokeV2(
    observationsRoute,
    f.admin.token,
    'GET',
    `${f.path}/observations?limit=1&unmapped=true`,
    f.params
  );
  expect(response.status).toBe(200);
  const text = await response.text(),
    first = JSON.parse(text);
  expect(text).not.toContain('private-observed-value');
  expect(text).not.toContain('sensitive-hash');
  expect(first.data).toHaveLength(1);
  first.data.forEach((item: unknown) => conformsToSchema('AutomationObservation', item));
  expect(first.pagination.hasMore).toBe(true);
  const next = await invokeV2(
    observationsRoute,
    f.admin.token,
    'GET',
    `${f.path}/observations?limit=1&unmapped=true&cursor=${first.pagination.nextCursor}`,
    f.params
  );
  expect((await next.json()).pagination.hasMore).toBe(false);
  expect(
    (await invokeV2(decisionsRoute, f.admin.token, 'GET', `${f.path}/decisions`, f.params)).status
  ).toBe(403);
  const reader = await createV2Credential(['automation:read', 'incidents:read']);
  expect(
    (await invokeV2(decisionsRoute, reader.token, 'GET', `${f.path}/decisions`, f.params)).status
  ).toBe(200);
});

it('fences concurrent restoration and rechecks membership and revoked credentials on replay', async () => {
  const f = await fixture();
  const team = await db.team.create({ data: { name: `Editors ${randomUUID()}` } });
  await db.service.update({ where: { id: f.service.id }, data: { teamId: team.id } });
  const editor = await createV2Credential(['automation:read', 'automation:write'], 'RESPONDER');
  const restore = (key: string, revision = '"1"') =>
    invokeV2(
      restoreDraftRoute,
      editor.token,
      'POST',
      `${f.path}/restore`,
      f.params,
      { sourceVersionId: f.version.id },
      { 'If-Match': revision, 'Idempotency-Key': key }
    );
  expect((await restore(randomUUID())).status).toBe(403);
  const membership = await db.teamMember.create({
    data: { userId: editor.user.id, teamId: team.id },
  });
  const keys = [randomUUID(), randomUUID()];
  const results = await Promise.all(keys.map(key => restore(key)));
  expect(results.map(r => r.status).sort()).toEqual([200, 412]);
  const winner = keys[results.findIndex(r => r.status === 200)];
  await db.teamMember.delete({ where: { id: membership.id } });
  expect((await restore(winner)).status).toBe(403);
  await db.teamMember.create({ data: { userId: editor.user.id, teamId: team.id } });
  await db.apiKey.update({ where: { id: editor.key.id }, data: { revokedAt: new Date() } });
  expect((await restore(winner)).status).toBe(401);
  expect(await db.auditLog.count({ where: { action: 'automation.draft.restored' } })).toBe(1);
});

it('enforces decision history capabilities and never loads stored explanations', async () => {
  const f = await fixture();
  const team = await db.team.create({ data: { name: `Decision readers ${randomUUID()}` } });
  await db.service.update({ where: { id: f.service.id }, data: { teamId: team.id } });
  const reader = await createV2Credential(['automation:read', 'incidents:read'], 'USER');
  await db.teamMember.create({ data: { teamId: team.id, userId: reader.user.id } });
  for (const visibility of ['PUBLIC', 'PRIVATE'] as const) {
    const incident = await db.incident.create({
      data: { title: 'Hidden source text', serviceId: f.service.id, visibility },
    });
    await db.incidentAutomationDecision.create({
      data: {
        incidentId: incident.id,
        serviceId: f.service.id,
        versionId: f.version.id,
        mode: 'LIVE',
        routeType: 'SERVICE_DEFAULT',
        evaluationAt: new Date(),
        summary: { secret: 'private-stored-explanation' },
      },
    });
  }
  const response = await invokeV2(
    decisionsRoute,
    reader.token,
    'GET',
    `${f.path}/decisions`,
    f.params
  );
  expect(response.status).toBe(403);
  const auditor = await createV2Credential(['automation:read', 'incidents:read'], 'AUDITOR');
  const permitted = await invokeV2(
    decisionsRoute,
    auditor.token,
    'GET',
    `${f.path}/decisions`,
    f.params
  );
  expect(permitted.status).toBe(200);
  const text = await permitted.text();
  expect(JSON.parse(text).data).toHaveLength(2);
  JSON.parse(text).data.forEach((item: unknown) => conformsToSchema('AutomationDecision', item));
  expect(text).not.toContain('private-stored-explanation');
  expect(text).not.toContain('Hidden source text');
});

it('rolls a restored draft and replay record back when canonical audit persistence fails', async () => {
  const f = await fixture(),
    key = randomUUID();
  const restore = () =>
    invokeV2(
      restoreDraftRoute,
      f.admin.token,
      'POST',
      `${f.path}/restore`,
      f.params,
      { sourceVersionId: f.version.id },
      { 'If-Match': '"1"', 'Idempotency-Key': key }
    );
  await db.$executeRawUnsafe(`CREATE FUNCTION api_v2_restore_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.action = 'automation.draft.restored' THEN RAISE EXCEPTION 'Injected restoration audit failure'; END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe(
    'CREATE TRIGGER api_v2_restore_reject_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION api_v2_restore_reject_audit()'
  );
  try {
    expect((await restore()).status).toBe(500);
    expect(
      await db.automationDraft.findUniqueOrThrow({ where: { serviceId: f.service.id } })
    ).toMatchObject({ revision: 1, restoredFromVersionId: null });
    expect(
      await db.backgroundJob.count({
        where: { payload: { path: ['task'], equals: 'IDEMPOTENCY_RECORD' } },
      })
    ).toBe(0);
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER api_v2_restore_reject_audit ON "AuditLog"');
    await db.$executeRawUnsafe('DROP FUNCTION api_v2_restore_reject_audit()');
  }
  expect((await restore()).status).toBe(200);
  expect(await db.auditLog.count({ where: { action: 'automation.draft.restored' } })).toBe(1);
});

it('reports version-scoped health with separate errors and fallbacks and explicit evidence freshness', async () => {
  const f = await fixture();
  await db.automationShadowAggregate.create({
    data: {
      serviceId: f.service.id,
      versionId: f.version.id,
      bucketDate: new Date(new Date().toISOString().slice(0, 10)),
      evaluated: 1,
      errors: 1,
      fallbacks: 1,
      priorityDifferent: 1,
    },
  });
  const response = await f.read();
  expect((await response.json()).data.health).toMatchObject({
    windowDays: 7,
    active: {
      versionId: f.version.id,
      evaluated: 1,
      errors: 1,
      fallbacks: 1,
      priorityDifferent: 1,
    },
    candidate: null,
    candidateEvidenceFreshness: null,
  });
});

it('creates an initially disabled configuration from revision zero and rejects nonconcrete mode validators', async () => {
  const admin = await createV2Credential(['automation:read', 'automation:publish']);
  const service = await createTestService('Uninitialized automation');
  const params = { id: service.id },
    path = `/services/${service.id}/automation`;
  const initial = await invokeV2(getConfiguration, admin.token, 'GET', path, params);
  expect(initial.headers.get('etag')).toBe('"0"');
  expect((await initial.json()).data).toMatchObject({
    revision: 0,
    mode: 'DISABLED',
    activeVersionId: null,
    health: { active: null, candidate: null },
  });
  const mutate = (validator?: string) =>
    invokeV2(
      changeModeRoute,
      admin.token,
      'PATCH',
      `${path}/mode`,
      params,
      { mode: 'DISABLED', expectedActiveVersionId: null },
      {
        'Idempotency-Key': randomUUID(),
        ...(validator === undefined ? {} : { 'If-Match': validator }),
      }
    );
  expect((await mutate()).status).toBe(428);
  expect((await mutate('*')).status).toBe(400);
  expect((await mutate('W/"0"')).status).toBe(412);
  const results = await Promise.all([mutate('"0"'), mutate('"0"')]);
  expect(results.map(result => result.status).sort()).toEqual([200, 412]);
  const final = await invokeV2(getConfiguration, admin.token, 'GET', path, params);
  expect(final.headers.get('etag')).toBe('"1"');
});
