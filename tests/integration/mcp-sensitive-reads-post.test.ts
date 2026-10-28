import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createTestService, testPrisma as db } from '../helpers/test-db';
import {
  describeSensitiveReads,
  principal,
  setupMcpReadDatabase,
  type ReadScenario,
} from '../helpers/mcp-read-scenarios';
import { createServiceBinding } from '@/lib/runbooks/bindings';
import { createRunbook, publishDraftVersion } from '@/lib/runbooks/versioning';
import { MCP_OPERATION_MAP } from '@/lib/mcp/catalog';
import { callMcpOperation } from '@/lib/mcp/core/execution';

setupMcpReadDatabase();

type Owner = { id: string };

async function integrationFixture(type: 'EVENTS_API_V2' | 'CLOUDWATCH' = 'EVENTS_API_V2') {
  const service = await createTestService('Validation read integration');
  const integration = await db.integration.create({
    data: {
      name: 'Validation read integration',
      serviceId: service.id,
      type,
      key: `intkey-${randomUUID()}`,
    },
  });
  return { serviceId: service.id, integrationId: integration.id };
}

async function ruleFixture(owner: Owner) {
  const service = await createTestService('Validation read rule');
  const runbook = await createRunbook(
    {
      name: 'Validation read runbook',
      slug: `validation-read-${randomUUID().slice(0, 8)}`,
      description: '',
      definition: {
        steps: [
          { key: 'check', name: 'Check', type: 'MANUAL', riskClass: 'READ_ONLY', config: {} },
        ],
      },
    },
    owner.id
  );
  const version = await publishDraftVersion(runbook.draftVersionId!, owner.id);
  const rule = await createServiceBinding(
    service.id,
    {
      runbookId: runbook.id,
      runbookVersionId: version.id,
      versionStrategy: 'PINNED',
      mode: 'AUTOMATIC',
      enabled: true,
    },
    { id: owner.id, apiKeyId: 'fixture' },
    { event: 'INCIDENT_CREATED', enabled: true, conditionLogic: 'AND', conditions: [] },
    version.id
  );
  return { serviceId: service.id, ruleId: rule.id };
}

const scenarios: ReadScenario[] = [
  {
    name: 'report metrics query',
    operationId: 'queryReportMetrics',
    setup: async () => ({ body: { metrics: ['totalIncidents', 'ackRate'], windowDays: 7 } }),
  },
  {
    name: 'integration configuration check',
    operationId: 'validateIntegrationConfiguration',
    setup: async () => ({ path: { id: (await integrationFixture()).integrationId } }),
  },
  {
    name: 'integration sample payload check',
    operationId: 'validateIntegrationPayload',
    setup: async () => ({
      path: { id: (await integrationFixture()).integrationId },
      body: { payload: { event_action: 'trigger', payload: { summary: 'x' } } },
    }),
  },
  {
    name: 'runbook rule readiness',
    operationId: 'validateServiceRunbookRule',
    setup: async owner => {
      const rule = await ruleFixture(owner);
      return { path: { id: rule.serviceId, ruleId: rule.ruleId }, body: {} };
    },
  },
];

describeSensitiveReads(scenarios);

describe('side-effect-free POST reads', () => {
  it('refuse an idempotency key or revision precondition (they are not writes)', async () => {
    const admin = await principal(
      'ADMIN',
      MCP_OPERATION_MAP.get('queryReportMetrics')!.requiredScopes
    );
    for (const extra of [{ idempotencyKey: 'a'.repeat(32) }, { ifMatch: '"1"' }])
      await expect(
        callMcpOperation(admin.ctx(), 'queryReportMetrics', {
          body: { metrics: ['totalIncidents'] },
          ...extra,
        })
      ).rejects.toThrow();
  });

  it('report validation failures without ingesting, storing or emitting the sample', async () => {
    const operation = MCP_OPERATION_MAP.get('validateIntegrationPayload')!;
    const admin = await principal('ADMIN', operation.requiredScopes);
    const { integrationId } = await integrationFixture();
    const before = [await db.alert.count(), await db.incident.count()];
    const result = await callMcpOperation(admin.ctx(), 'validateIntegrationPayload', {
      path: { id: integrationId },
      body: { payload: { event_action: 'not-an-action' } },
    });
    const verdict = (result.data as { data: { valid: boolean; errors: unknown[] } }).data;
    expect(verdict.valid).toBe(false);
    expect(verdict.errors.length).toBeGreaterThan(0);
    expect([await db.alert.count(), await db.incident.count()]).toEqual(before);
    expect(JSON.stringify(result)).not.toContain('intkey-');
  });

  it('report the configuration verdict without returning integration credentials', async () => {
    const operation = MCP_OPERATION_MAP.get('validateIntegrationConfiguration')!;
    const admin = await principal('ADMIN', operation.requiredScopes);
    const { integrationId } = await integrationFixture('CLOUDWATCH');
    const result = await callMcpOperation(admin.ctx(), 'validateIntegrationConfiguration', {
      path: { id: integrationId },
    });
    expect(result.data).toMatchObject({ data: { valid: false, activationAllowed: false } });
    expect(JSON.stringify(result)).not.toContain('intkey-');
  });

  it('keeps the rerun preview unexposed because it carries an execution authorization token', () => {
    const operation = MCP_OPERATION_MAP.get('previewRunbookExecutionRerun')!;
    expect(operation.status).not.toBe('SENSITIVE_READ');
    expect(operation.reason).toMatch(/authorization token/);
  });
});
