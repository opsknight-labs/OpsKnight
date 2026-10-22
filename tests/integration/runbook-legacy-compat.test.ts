import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import {
  testPrisma as db,
  resetDatabase,
  createTestIncident,
  createTestService,
} from '../helpers/test-db';
import { computeDefinitionChecksum, parseRunbookDefinition } from '@/lib/runbooks/definition';
import { processRunbookJob } from '@/lib/runbooks/orchestrator';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

/** Rules written exactly as they existed before Service Automation: no integration columns set. */
async function legacyRule(mode: 'SUGGESTED' | 'AUTOMATIC') {
  const definition = parseRunbookDefinition(
    {
      steps: [
        {
          key: 'check',
          name: 'Check api',
          type: 'SYSTEMD',
          riskClass: 'READ_ONLY',
          config: { action: 'status', unit: 'api.service' },
        },
      ],
    } as unknown as Prisma.InputJsonValue,
    []
  );
  const runbook = await db.runbook.create({
    data: { name: `Legacy ${crypto.randomUUID()}`, slug: `legacy-${crypto.randomUUID()}` },
  });
  const version = await db.runbookVersion.create({
    data: {
      runbookId: runbook.id,
      version: 1,
      state: 'PUBLISHED',
      publishedAt: new Date(),
      definition: definition as unknown as Prisma.InputJsonValue,
      checksum: computeDefinitionChecksum(definition),
    },
  });
  await db.runbook.update({ where: { id: runbook.id }, data: { publishedVersionId: version.id } });
  const agent = await db.runbookAgent.create({
    data: {
      name: `agent-${crypto.randomUUID()}`,
      status: 'ONLINE',
      capabilities: ['RUNBOOK_SYSTEMD'],
      lastHeartbeatAt: new Date(),
    },
  });
  const pool = await db.runbookAgentPool.create({
    data: { name: `pool-${crypto.randomUUID()}`, members: { create: { agentId: agent.id } } },
  });
  const service = await createTestService('Legacy runbooks');
  const rule = await db.serviceAutomationRule.create({
    data: {
      serviceId: service.id,
      runbookId: runbook.id,
      runbookVersionId: version.id,
      mode,
      versionStrategy: 'PINNED',
      enabled: true,
      defaultAgentPoolId: pool.id,
      inputValues: {},
      triggers: { create: { event: 'INCIDENT_CREATED' } },
    },
  });
  // Trigger authoring intentionally pauses AUTOMATIC bindings; explicitly activate
  // the completed read-only legacy fixture after its trigger is attached.
  if (mode === 'AUTOMATIC') {
    await db.serviceAutomationRule.update({ where: { id: rule.id }, data: { enabled: true } });
  }
  return { service, rule };
}

const evaluate = (incidentId: string, source: 'MANUAL' | 'MONITORING') =>
  processRunbookJob({
    kind: 'EVALUATE_TRIGGER',
    incidentId,
    sourceEventId: crypto.randomUUID(),
    source,
  });

describeIfRealDB('legacy runbook rules with Service Automation off', () => {
  beforeAll(resetDatabase);
  afterAll(resetDatabase);

  it('gives legacy rules the safe defaults and no unattended-write authorization', async () => {
    const { rule } = await legacyRule('AUTOMATIC');
    expect(
      await db.serviceAutomationRule.findUniqueOrThrow({ where: { id: rule.id } })
    ).toMatchObject({
      runOnMonitoringIncidents: false,
      resolveOnVerifiedRecovery: false,
      unattendedWritesAuthorizedAt: null,
      unattendedWritesScopeHash: null,
      contextInputMappings: [],
      contextTargetMappings: {},
    });
  });

  it('still suggests a legacy SUGGESTED rule for a manually created incident', async () => {
    const { service, rule } = await legacyRule('SUGGESTED');
    const incident = await createTestIncident('Manual legacy', service.id);
    await evaluate(incident.id, 'MANUAL');
    expect(await db.runbookSuggestion.count({ where: { bindingId: rule.id } })).toBe(1);
  });

  it('does not run a legacy rule for monitoring incidents until it opts in', async () => {
    const { service, rule } = await legacyRule('SUGGESTED');
    const incident = await createTestIncident('Monitoring legacy', service.id);
    await evaluate(incident.id, 'MONITORING');
    expect(await db.runbookSuggestion.count({ where: { bindingId: rule.id } })).toBe(0);
    expect(await db.runbookExecution.count({ where: { bindingId: rule.id } })).toBe(0);
  });

  it('starts a legacy AUTOMATIC read-only rule without any new authorization', async () => {
    const { service, rule } = await legacyRule('AUTOMATIC');
    const incident = await createTestIncident('Automatic legacy', service.id);
    await evaluate(incident.id, 'MANUAL');
    const executions = await db.runbookExecution.findMany({ where: { bindingId: rule.id } });
    expect(executions).toHaveLength(1);
    expect(executions[0]).toMatchObject({ incidentId: incident.id, triggeredByType: 'TRIGGER' });
  });
});
