import { submitPolicyCheck } from '@/lib/runbooks/policy-checks';
import { beforeEach, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { getOpenApiV2Spec } from '@/lib/api-v2/openapi';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import { testPrisma as db, resetDatabase, createTestService } from '../helpers/test-db';
import { createRunbook, publishDraftVersion } from '@/lib/runbooks/versioning';
import { GET as list, POST as create } from '@/app/api/v2/services/[id]/runbook-rules/route';
import {
  GET as read,
  PATCH as update,
  DELETE as detach,
} from '@/app/api/v2/services/[id]/runbook-rules/[ruleId]/route';
import { POST as validate } from '@/app/api/v2/services/[id]/runbook-rules/[ruleId]/validate/route';
import { POST as activate } from '@/app/api/v2/services/[id]/runbook-rules/[ruleId]/activate/route';
import { POST as pause } from '@/app/api/v2/services/[id]/runbook-rules/[ruleId]/pause/route';
import { POST as duplicate } from '@/app/api/v2/services/[id]/runbook-rules/[ruleId]/duplicate/route';
import { PUT as triggers } from '@/app/api/v2/services/[id]/runbook-rules/[ruleId]/triggers/route';
import {
  POST as requestChecks,
  GET as checks,
} from '@/app/api/v2/services/[id]/runbook-rules/[ruleId]/policy-checks/route';
import type { NextRouteHandler } from '@/lib/api-v2/endpoint';
import type { AppRole } from '@/lib/authorization';
const scopes = ['runbook-rules:read', 'runbook-rules:write', 'runbook-rules:activate'];
beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test database required');
  await resetDatabase();
});
async function fixture(agentStep = false) {
  const credential = await createV2Credential(scopes);
  const service = await createTestService('REST rule fixture');
  const runbook = await createRunbook(
    {
      name: 'REST rule fixture',
      slug: `rest-rule-${crypto.randomUUID()}`,
      description: '',
      definition: {
        steps: [
          {
            key: 'check',
            name: 'Check',
            type: agentStep ? 'LINUX_DIAGNOSTICS' : 'MANUAL',
            riskClass: 'READ_ONLY',
            config: agentStep ? { action: 'summary' } : {},
          },
        ],
      },
    },
    credential.user.id
  );
  const version = await publishDraftVersion(runbook.draftVersionId!, credential.user.id);
  const configuration = {
    runbookId: runbook.id,
    runbookVersionId: version.id,
    versionStrategy: 'PINNED',
    mode: 'AUTOMATIC',
    enabled: true,
  };
  return { ...credential, service, runbook, version, configuration };
}
function call(
  handler: NextRouteHandler,
  token: string,
  method: string,
  serviceId: string,
  ruleId?: string,
  body?: unknown,
  etag?: string,
  key = crypto.randomUUID(),
  suffix = ''
) {
  const params = { id: serviceId, ...(ruleId ? { ruleId } : {}) };
  return invokeV2(
    handler,
    token,
    method,
    `/services/${serviceId}/runbook-rules${ruleId ? `/${ruleId}` : ''}${suffix}`,
    params,
    body,
    { 'Idempotency-Key': key, ...(etag ? { 'If-Match': etag } : {}) }
  );
}
async function createRule(
  f: Awaited<ReturnType<typeof fixture>>,
  extra: Record<string, unknown> = {}
) {
  const response = await call(create, f.token, 'POST', f.service.id, undefined, {
    configuration: { ...f.configuration, ...extra },
    expectedVersionId: f.version.id,
    trigger: { event: 'INCIDENT_CREATED', enabled: true, conditions: [] },
  });
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
  return { data: (await response.json()).data, etag: response.headers.get('etag')! };
}
function valid(schema: string, data: unknown) {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema({ $id: 'rule-spec', components: getOpenApiV2Spec().components });
  const check = ajv.getSchema(`rule-spec#/components/schemas/${schema}`)!;
  expect(check(data), JSON.stringify(check.errors)).toBe(true);
}
it('creates a paused Automatic rule, uses shared readiness and requires explicit match-all review before activation', async () => {
  const f = await fixture();
  const rule = await createRule(f);
  valid('ServiceRunbookRule', rule.data);
  expect(rule.data.enabled).toBe(false);
  expect(rule.data.resolvedVersionId).toBe(f.version.id);
  const auditsBefore = await db.auditLog.count();
  const jobsBefore = await db.backgroundJob.count();
  const review = await call(validate, f.token, 'POST', f.service.id, rule.data.id, {});
  expect(review.status).toBe(200);
  valid('RunbookRuleReadiness', (await review.json()).data);
  expect(await db.auditLog.count()).toBe(auditsBefore);
  expect(await db.backgroundJob.count()).toBe(jobsBefore);
  expect(await db.runbookExecution.count()).toBe(0);
  expect(
    (await call(activate, f.token, 'POST', f.service.id, rule.data.id, {}, rule.etag)).status
  ).toBe(400);
  const activated = await call(
    activate,
    f.token,
    'POST',
    f.service.id,
    rule.data.id,
    { confirmMatchAll: true },
    rule.etag
  );
  expect(activated.status).toBe(200);
  expect((await activated.json()).data.enabled).toBe(true);
  const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'runbook.rule.activated' } });
  expect(audit.details).toMatchObject({ source: 'API', metadata: { apiClientId: f.key.id } });
});
it('fences concurrent writes and records one canonical audit plus durable replay', async () => {
  const f = await fixture();
  const rule = await createRule(f);
  const results = await Promise.all(
    ['One', 'Two'].map(name =>
      call(
        update,
        f.token,
        'PATCH',
        f.service.id,
        rule.data.id,
        { configuration: { name }, expectedVersionId: f.version.id },
        rule.etag
      )
    )
  );
  expect(results.map(row => row.status).sort()).toEqual([200, 412]);
  expect(await db.auditLog.count({ where: { action: 'runbook.service.binding.updated' } })).toBe(1);
  const current = await call(read, f.token, 'GET', f.service.id, rule.data.id);
  const etag = current.headers.get('etag')!;
  const key = crypto.randomUUID();
  const body = { configuration: { name: 'Replayed' }, expectedVersionId: f.version.id };
  const first = await call(update, f.token, 'PATCH', f.service.id, rule.data.id, body, etag, key);
  expect(first.status).toBe(200);
  const replay = await call(update, f.token, 'PATCH', f.service.id, rule.data.id, body, etag, key);
  expect(replay.status).toBe(200);
  expect(replay.headers.get('idempotency-replayed')).toBe('true');
  expect(await db.auditLog.count({ where: { action: 'runbook.service.binding.updated' } })).toBe(2);
});
it('invalidates validators and pauses Automatic rules when direct nested condition writes change their reviewed configuration', async () => {
  const f = await fixture();
  const rule = await createRule(f);
  const activated = await call(
    activate,
    f.token,
    'POST',
    f.service.id,
    rule.data.id,
    { confirmMatchAll: true },
    rule.etag
  );
  expect(activated.status).toBe(200);
  const etag = activated.headers.get('etag')!;
  await db.runbookTriggerCondition.create({
    data: {
      triggerId: rule.data.triggers[0].id,
      field: 'incident.urgency',
      operator: 'EQUALS',
      value: 'HIGH',
      sequence: 0,
    },
  });
  const current = await call(read, f.token, 'GET', f.service.id, rule.data.id);
  const data = (await current.json()).data;
  expect(data.enabled).toBe(false);
  expect(current.headers.get('etag')).not.toBe(etag);
  expect(
    (
      await call(
        activate,
        f.token,
        'POST',
        f.service.id,
        rule.data.id,
        { confirmMatchAll: true },
        etag
      )
    ).status
  ).toBe(412);
});
it('replaces triggers with final revision, creates an independent paused copy, pauses and safely detaches without deleting evidence', async () => {
  const f = await fixture();
  const rule = await createRule(f);
  const configured = await call(
    triggers,
    f.token,
    'PUT',
    f.service.id,
    rule.data.id,
    {
      event: 'INCIDENT_CREATED',
      conditionLogic: 'AND',
      enabled: true,
      conditions: [{ field: 'incident.urgency', operator: 'EQUALS', value: 'HIGH' }],
    },
    rule.etag
  );
  expect(configured.status).toBe(200);
  const data = (await configured.json()).data;
  expect(data.enabled).toBe(false);
  expect(data.triggers[0].conditions).toHaveLength(1);
  const get = await call(read, f.token, 'GET', f.service.id, rule.data.id);
  expect(get.headers.get('etag')).toBe(configured.headers.get('etag'));
  const copy = await call(
    duplicate,
    f.token,
    'POST',
    f.service.id,
    rule.data.id,
    {},
    configured.headers.get('etag')!
  );
  expect(copy.status).toBe(201);
  const copied = (await copy.json()).data;
  valid('ServiceRunbookRule', copied);
  expect(copied.enabled).toBe(false);
  expect(copied.id).not.toBe(rule.data.id);
  const copiedRead = await call(read, f.token, 'GET', f.service.id, copied.id);
  expect(copiedRead.headers.get('etag')).toBe(copy.headers.get('etag'));
  const paused = await call(
    pause,
    f.token,
    'POST',
    f.service.id,
    copied.id,
    {},
    copy.headers.get('etag')!
  );
  expect(paused.status).toBe(200);
  const key = crypto.randomUUID();
  const etag = paused.headers.get('etag')!;
  expect(
    (await call(detach, f.token, 'DELETE', f.service.id, copied.id, {}, etag, key)).status
  ).toBe(204);
  const replay = await call(detach, f.token, 'DELETE', f.service.id, copied.id, {}, etag, key);
  expect(replay.status).toBe(204);
  expect(replay.headers.get('idempotency-replayed')).toBe('true');
  expect((await call(read, f.token, 'GET', f.service.id, copied.id)).status).toBe(404);
  expect(
    (await db.serviceAutomationRule.findUniqueOrThrow({ where: { id: copied.id } })).detachedAt
  ).not.toBeNull();
});
it('keeps pagination and nested resources within their service parent', async () => {
  const f = await fixture();
  const first = await createRule(f);
  await createRule(f, { name: 'Second' });
  const foreign = await createTestService('Foreign service');
  for (const [handler, method, body] of [
    [read, 'GET', undefined],
    [update, 'PATCH', { configuration: { name: 'Wrong parent' }, expectedVersionId: f.version.id }],
    [validate, 'POST', {}],
    [requestChecks, 'POST', {}],
  ] as const)
    expect(
      (await call(handler, f.token, method, foreign.id, first.data.id, body, first.etag)).status
    ).toBe(404);
  const page = await call(
    list,
    f.token,
    'GET',
    f.service.id,
    undefined,
    undefined,
    undefined,
    undefined,
    '?limit=1'
  );
  expect(page.status).toBe(200);
  const body = await page.json();
  expect(body.data).toHaveLength(1);
  valid('ServiceRunbookRuleSummary', body.data[0]);
  expect(body.data[0]).not.toHaveProperty('inputValues');
  expect(body.data[0]).not.toHaveProperty('triggers');
  expect(body.pagination.nextCursor).toBeTruthy();
  const second = await call(
    list,
    f.token,
    'GET',
    f.service.id,
    undefined,
    undefined,
    undefined,
    undefined,
    `?limit=1&cursor=${encodeURIComponent(body.pagination.nextCursor)}`
  );
  expect(second.status).toBe(200);
  expect((await second.json()).data[0].id).not.toBe(body.data[0].id);
});
it('requests durable Agent policy checks with canonical attribution and returns metadata without configuration/results', async () => {
  const f = await fixture(true);
  const agent = await db.runbookAgent.create({
    data: {
      name: 'Policy check Agent',
      status: 'ONLINE',
      lastHeartbeatAt: new Date(),
      policyHash: 'b'.repeat(64),
      capabilities: ['RUNBOOK_LINUX_DIAGNOSTICS'],
    },
  });
  const rule = await createRule(f, { defaultAgentId: agent.id });
  const key = crypto.randomUUID();
  const response = await call(
    requestChecks,
    f.token,
    'POST',
    f.service.id,
    rule.data.id,
    {},
    rule.etag,
    key
  );
  expect(response.status).toBe(202);
  const requested = (await response.json()).data;
  valid('RunbookRulePolicyRequest', requested);
  expect(requested.status).toBe('PENDING');
  expect(requested.checkIds).toHaveLength(1);
  const replay = await call(
    requestChecks,
    f.token,
    'POST',
    f.service.id,
    rule.data.id,
    {},
    rule.etag,
    key
  );
  expect(replay.status).toBe(202);
  expect(replay.headers.get('idempotency-replayed')).toBe('true');
  expect(await db.runbookPolicyCheck.count()).toBe(1);
  const result = await call(checks, f.token, 'GET', f.service.id, rule.data.id);
  expect(result.status).toBe(200);
  const rows = (await result.json()).data;
  valid('RunbookRulePolicyCheck', rows[0]);
  expect(rows.map((row: { id: string }) => row.id)).toEqual(requested.checkIds);
  expect(rows[0]).not.toHaveProperty('steps');
  expect(rows[0]).not.toHaveProperty('results');
  expect(rows[0].status).toBe('PENDING');
  expect(await db.runbookExecution.count()).toBe(0);
  expect(
    (
      await call(
        activate,
        f.token,
        'POST',
        f.service.id,
        rule.data.id,
        { confirmMatchAll: true },
        rule.etag
      )
    ).status
  ).toBe(400);
  const stored = await db.runbookPolicyCheck.findFirstOrThrow({ where: { ruleId: rule.data.id } });
  await submitPolicyCheck(agent.id, {
    id: stored.id,
    policyHash: agent.policyHash,
    results: [{ key: 'check', allowed: true }],
  });
  const accepted = await call(
    activate,
    f.token,
    'POST',
    f.service.id,
    rule.data.id,
    { confirmMatchAll: true },
    rule.etag
  );
  expect(accepted.status, JSON.stringify(await accepted.clone().json())).toBe(200);
  const paused = await call(
    pause,
    f.token,
    'POST',
    f.service.id,
    rule.data.id,
    {},
    accepted.headers.get('etag')!
  );
  expect(paused.status).toBe(200);
  await db.runbookAgent.update({ where: { id: agent.id }, data: { policyHash: 'c'.repeat(64) } });
  expect(
    (
      await call(
        activate,
        f.token,
        'POST',
        f.service.id,
        rule.data.id,
        { confirmMatchAll: true },
        paused.headers.get('etag')!
      )
    ).status
  ).toBe(400);
});
it.each(['RESPONDER', 'AUDITOR', 'USER'] as AppRole[])(
  'denies %s even with all rule scopes',
  async role => {
    const f = await fixture();
    const rule = await createRule(f);
    const other = await createV2Credential(scopes, role);
    for (const [handler, method, body] of [
      [read, 'GET', undefined],
      [list, 'GET', undefined],
      [update, 'PATCH', { configuration: { name: 'Denied' }, expectedVersionId: f.version.id }],
      [activate, 'POST', { confirmMatchAll: true }],
      [requestChecks, 'POST', {}],
      [checks, 'GET', undefined],
      [pause, 'POST', {}],
      [duplicate, 'POST', {}],
      [triggers, 'PUT', { event: 'INCIDENT_CREATED' }],
      [detach, 'DELETE', {}],
      [validate, 'POST', {}],
    ] as const)
      expect(
        (await call(handler, other.token, method, f.service.id, rule.data.id, body, rule.etag))
          .status
      ).toBe(403);
  }
);
it('requires explicit activation privilege, rejects wildcard and missing revisions, and refuses cached results after demotion', async () => {
  const f = await fixture();
  const rule = await createRule(f);
  const configured = await createV2Credential([
    'runbook-rules:read',
    'runbook-rules:write',
    'admin:manage',
  ]);
  expect(
    (
      await call(
        activate,
        configured.token,
        'POST',
        f.service.id,
        rule.data.id,
        { confirmMatchAll: true },
        rule.etag
      )
    ).status
  ).toBe(403);
  expect((await call(pause, f.token, 'POST', f.service.id, rule.data.id, {})).status).toBe(428);
  expect((await call(pause, f.token, 'POST', f.service.id, rule.data.id, {}, '*')).status).toBe(
    400
  );
  const key = crypto.randomUUID();
  const first = await call(
    duplicate,
    f.token,
    'POST',
    f.service.id,
    rule.data.id,
    {},
    rule.etag,
    key
  );
  expect(first.status).toBe(201);
  await db.user.update({ where: { id: f.user.id }, data: { role: 'RESPONDER' } });
  expect(
    (await call(duplicate, f.token, 'POST', f.service.id, rule.data.id, {}, rule.etag, key)).status
  ).toBe(403);
  await db.apiKey.update({ where: { id: f.key.id }, data: { revokedAt: new Date() } });
  expect(
    (await call(duplicate, f.token, 'POST', f.service.id, rule.data.id, {}, rule.etag, key)).status
  ).toBe(401);
});
it('rolls back configuration, nested triggers, canonical audit and replay on audit insertion failure', async () => {
  const f = await fixture();
  const key = crypto.randomUUID();
  const body = {
    configuration: f.configuration,
    expectedVersionId: f.version.id,
    trigger: { event: 'INCIDENT_CREATED' },
  };
  await db.$executeRawUnsafe(
    `CREATE FUNCTION test_rule_rest_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='runbook.service.attached' THEN RAISE EXCEPTION 'Rule audit fixture failure' USING ERRCODE='23514'; END IF; RETURN NEW; END; $$`
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER test_rule_rest_audit_failure_trigger BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION test_rule_rest_audit_failure()`
  );
  try {
    expect(
      (await call(create, f.token, 'POST', f.service.id, undefined, body, undefined, key)).status
    ).toBe(500);
    expect(await db.serviceAutomationRule.count()).toBe(0);
    expect(await db.runbookTrigger.count()).toBe(0);
    expect(await db.backgroundJob.count()).toBe(0);
  } finally {
    await db.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS test_rule_rest_audit_failure_trigger ON "AuditLog"'
    );
    await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS test_rule_rest_audit_failure()');
  }
  expect(
    (await call(create, f.token, 'POST', f.service.id, undefined, body, undefined, key)).status
  ).toBe(201);
});
it('rejects unknown configuration fields, future trigger events and mismatched reviewed versions without writes', async () => {
  const f = await fixture();
  for (const body of [
    {
      configuration: { ...f.configuration, secretPlaintext: 'no' },
      expectedVersionId: f.version.id,
    },
    {
      configuration: f.configuration,
      expectedVersionId: f.version.id,
      trigger: { event: 'INCIDENT_RESOLVED' },
    },
    { configuration: f.configuration, expectedVersionId: f.runbook.id },
  ])
    expect((await call(create, f.token, 'POST', f.service.id, undefined, body)).status).toBe(400);
  expect(await db.serviceAutomationRule.count()).toBe(0);
});

it('does not repeat pause transitions or audits across different idempotency keys', async () => {
  const f = await fixture();
  const rule = await createRule(f);
  const active = await call(
    activate,
    f.token,
    'POST',
    f.service.id,
    rule.data.id,
    { confirmMatchAll: true },
    rule.etag
  );
  expect(active.status).toBe(200);
  const first = await call(
    pause,
    f.token,
    'POST',
    f.service.id,
    rule.data.id,
    {},
    active.headers.get('etag')!
  );
  expect(first.status).toBe(200);
  const again = await call(
    pause,
    f.token,
    'POST',
    f.service.id,
    rule.data.id,
    {},
    first.headers.get('etag')!
  );
  expect(again.status).toBe(200);
  expect(again.headers.get('etag')).toBe(first.headers.get('etag'));
  expect(await db.auditLog.count({ where: { action: 'runbook.rule.paused' } })).toBe(1);
});
it('rejects ill-typed trigger comparisons before persisting or advancing a revision', async () => {
  const f = await fixture();
  const rule = await createRule(f);
  const response = await call(
    triggers,
    f.token,
    'PUT',
    f.service.id,
    rule.data.id,
    {
      event: 'INCIDENT_CREATED',
      conditions: [{ field: 'incident.urgency', operator: 'IN', value: 'HIGH' }],
    },
    rule.etag
  );
  expect(response.status).toBe(400);
  expect((await call(read, f.token, 'GET', f.service.id, rule.data.id)).headers.get('etag')).toBe(
    rule.etag
  );
});
it('keeps legacy oversized configuration out of paginated lists and rejects oversized detail safely', async () => {
  const f = await fixture();
  const rule = await createRule(f);
  await db.serviceAutomationRule.update({
    where: { id: rule.data.id },
    data: { inputValues: { legacy: 'x'.repeat(1_100_000) } },
  });
  const response = await call(list, f.token, 'GET', f.service.id);
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.data).toHaveLength(1);
  expect(body.data[0]).not.toHaveProperty('inputValues');
  expect(JSON.stringify(body).length).toBeLessThan(2000);
  expect((await call(read, f.token, 'GET', f.service.id, rule.data.id)).status).toBe(409);
});

it('accepts presence-only trigger conditions without requiring a fabricated comparison value', async () => {
  const f = await fixture();
  const rule = await createRule(f);
  const response = await call(
    triggers,
    f.token,
    'PUT',
    f.service.id,
    rule.data.id,
    {
      event: 'INCIDENT_CREATED',
      conditions: [{ field: 'incident.urgency', operator: 'EXISTS', value: null }],
    },
    rule.etag
  );
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
  expect((await response.json()).data.triggers[0].conditions[0]).toMatchObject({
    operator: 'EXISTS',
    value: null,
  });
});

it('rejects changed-validator replay for real service-rule edits', async () => {
  const f = await fixture();
  const rule = await createRule(f);
  const body = { configuration: { name: 'Reviewed rule' }, expectedVersionId: f.version.id };
  const key = 'rule-reviewed-revision';
  const original = await call(
    update,
    f.token,
    'PATCH',
    f.service.id,
    rule.data.id,
    body,
    rule.etag,
    key
  );
  expect(original.status).toBe(200);
  expect(
    (
      await call(update, f.token, 'PATCH', f.service.id, rule.data.id, body, rule.etag, key)
    ).headers.get('idempotency-replayed')
  ).toBe('true');
  const next = (await call(read, f.token, 'GET', f.service.id, rule.data.id)).headers.get('etag')!;
  expect(next).not.toBe(rule.etag);
  expect(
    (await call(update, f.token, 'PATCH', f.service.id, rule.data.id, body, next, key)).status
  ).toBe(409);
  expect(await db.auditLog.count({ where: { action: 'runbook.service.binding.updated' } })).toBe(1);
});
