import { beforeEach, describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import { computeDefinitionChecksum, parseRunbookDefinition } from '@/lib/runbooks/definition';
import { evaluateIncidentTriggers } from '@/lib/runbooks/triggers';
import {
  createTestIncident,
  createTestService,
  resetDatabase,
  testPrisma,
} from '../helpers/test-db';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

async function createAutomaticReadOnlyRule() {
  const parsed = parseRunbookDefinition(
    {
      steps: [
        {
          key: 'status',
          name: 'Status',
          type: 'SYSTEMD',
          riskClass: 'READ_ONLY',
          config: { action: 'status', unit: 'api.service' },
        },
      ],
    } as unknown as Prisma.InputJsonValue,
    []
  );
  const runbook = await testPrisma.runbook.create({
    data: { name: `Storm ${crypto.randomUUID()}`, slug: `storm-${crypto.randomUUID()}` },
  });
  const version = await testPrisma.runbookVersion.create({
    data: {
      runbookId: runbook.id,
      version: 1,
      state: 'DRAFT',
      definition: parsed as unknown as Prisma.InputJsonValue,
      checksum: computeDefinitionChecksum(parsed),
    },
  });
  await testPrisma.runbookVersion.update({
    where: { id: version.id },
    data: { state: 'PUBLISHED', publishedAt: new Date() },
  });
  await testPrisma.runbook.update({
    where: { id: runbook.id },
    data: { publishedVersionId: version.id },
  });
  const service = await createTestService('Storm rate');
  const agent = await testPrisma.runbookAgent.create({
    data: {
      name: `agent-${crypto.randomUUID()}`,
      status: 'ONLINE',
      capabilities: ['RUNBOOK_SYSTEMD'],
      lastHeartbeatAt: new Date(),
    },
  });
  const pool = await testPrisma.runbookAgentPool.create({
    data: { name: `pool-${crypto.randomUUID()}`, members: { create: { agentId: agent.id } } },
  });
  const binding = await testPrisma.serviceAutomationRule.create({
    data: {
      serviceId: service.id,
      runbookId: runbook.id,
      runbookVersionId: version.id,
      versionStrategy: 'PINNED',
      mode: 'AUTOMATIC',
      defaultAgentPoolId: pool.id,
      triggers: { create: { event: 'INCIDENT_CREATED' } },
    },
  });
  await testPrisma.serviceAutomationRule.update({
    where: { id: binding.id },
    data: { enabled: true },
  });
  return { service, binding, runbook };
}

const skipMessages = (incidentId: string) =>
  testPrisma.incidentEvent
    .findMany({ where: { incidentId, type: 'RUNBOOK_SKIPPED' }, select: { message: true } })
    .then(rows => rows.map(row => row.message));

describeIfRealDB('automatic runbook triggers: storm children and per-rule rate cap', () => {
  beforeEach(async () => resetDatabase(), 30000);

  it('does not start an automatic run for a storm child and records why', async () => {
    const { service } = await createAutomaticReadOnlyRule();
    const parent = await createTestIncident('Storm parent', service.id);
    const child = await createTestIncident('Storm child', service.id);
    await testPrisma.incidentRelationship.create({
      data: {
        sourceIncidentId: child.id,
        targetIncidentId: parent.id,
        type: 'PARENT_CHILD',
        origin: 'RULE',
        decision: 'ACCEPTED',
        evidence: { kind: 'prepaging_storm' },
        engineVersion: 'test',
      },
    });

    expect(await evaluateIncidentTriggers(child.id, 'storm-child-event')).toMatchObject({
      started: 0,
      skipped: 1,
    });
    expect(await testPrisma.runbookExecution.count()).toBe(0);
    expect(await skipMessages(child.id)).toEqual([expect.stringContaining('STORM_CHILD')]);
    // The parent itself still runs.
    expect(await evaluateIncidentTriggers(parent.id, 'storm-parent-event')).toMatchObject({
      started: 1,
    });
  });

  it('still runs for a child linked by anything other than a pre-paging storm', async () => {
    const { service } = await createAutomaticReadOnlyRule();
    const parent = await createTestIncident('Linked parent', service.id);
    const child = await createTestIncident('Linked child', service.id);
    await testPrisma.incidentRelationship.create({
      data: {
        sourceIncidentId: child.id,
        targetIncidentId: parent.id,
        type: 'PARENT_CHILD',
        origin: 'RULE',
        decision: 'ACCEPTED',
        evidence: { kind: 'correlation' },
        engineVersion: 'test',
      },
    });

    expect(await evaluateIncidentTriggers(child.id, 'linked-child-event')).toMatchObject({
      started: 1,
    });
  });

  it('caps one automatic rule at 5 runs per 10 minutes and records the skip', async () => {
    const { service } = await createAutomaticReadOnlyRule();
    const incidents = [];
    for (let i = 0; i < 6; i++) incidents.push(await createTestIncident(`Rate ${i}`, service.id));

    for (const incident of incidents.slice(0, 5)) {
      expect(await evaluateIncidentTriggers(incident.id, `rate-${incident.id}`)).toMatchObject({
        started: 1,
      });
    }
    const sixth = incidents[5];
    expect(await evaluateIncidentTriggers(sixth.id, `rate-${sixth.id}`)).toMatchObject({
      started: 0,
      skipped: 1,
    });
    expect(await testPrisma.runbookExecution.count()).toBe(5);
    expect(await skipMessages(sixth.id)).toEqual([expect.stringContaining('BINDING_RATE_LIMITED')]);

    // Runs older than the window no longer count.
    await testPrisma.runbookExecution.updateMany({
      data: { createdAt: new Date(Date.now() - 11 * 60_000) },
    });
    expect(await evaluateIncidentTriggers(sixth.id, `rate-retry-${sixth.id}`)).toMatchObject({
      started: 1,
    });
  });
});
