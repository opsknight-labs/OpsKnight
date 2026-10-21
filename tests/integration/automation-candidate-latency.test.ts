import { afterAll, beforeAll, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, arch, platform } from 'node:os';
import { testPrisma as db, resetDatabase, createTestUser } from '../helpers/test-db';
import { processIntegrationEvent } from '@/lib/events';
import { emptySnapshot, LIMITS } from '@/lib/automation/contract';
import { saveDraft, publishVersion, changeMode } from '@/lib/automation/versioning';
import { automationLoadSnapshot } from '../load/fixtures/automation';

beforeAll(async () => {
  await resetDatabase();
  await db.systemSettings.upsert({
    where: { id: 'default' },
    create: { automationEnabled: true },
    update: { automationEnabled: true },
  });
});
afterAll(async () => {
  await db.$disconnect();
});

it('measures bounded worst-size candidate overhead without changing LIVE decisions', async () => {
  const actor = await createTestUser({ role: 'ADMIN' });
  const service = await db.service.create({ data: { name: 'Candidate latency isolation' } });
  const draft = await saveDraft({
    serviceId: service.id,
    actorId: actor.id,
    expectedRevision: 0,
    snapshot: emptySnapshot,
  });
  const active = await publishVersion({
    serviceId: service.id,
    actorId: actor.id,
    expectedRevision: draft.revision,
    expectedActiveVersionId: null,
  });
  await changeMode({
    serviceId: service.id,
    actorId: actor.id,
    mode: 'LIVE',
    expectedActiveVersionId: active.id,
    acknowledgeNoShadow: true,
  });
  const results = [];
  for (const candidate of [false, true]) {
    if (candidate) {
      const next = await saveDraft({
        serviceId: service.id,
        actorId: actor.id,
        expectedRevision: draft.revision,
        snapshot: automationLoadSnapshot('live-worst'),
      });
      await publishVersion({
        serviceId: service.id,
        actorId: actor.id,
        expectedRevision: next.revision,
        expectedActiveVersionId: active.id,
      });
    }
    const durations: number[] = [];
    for (let index = 0; index < 40; index++) {
      const event = {
        event_action: 'trigger' as const,
        dedup_key: `latency-${candidate}-${index}`,
        payload: {
          summary: 'Candidate latency sample',
          source: 'candidate-latency',
          severity: 'warning' as const,
          custom_details: { value: 1 },
        },
      };
      const started = performance.now();
      await processIntegrationEvent({
        serviceId: service.id,
        integrationId: 'candidate-latency',
        integrationType: 'EVENTS_API',
        event,
        providerPayload: event,
        receivedAt: new Date(),
      });
      if (index >= 5) durations.push(performance.now() - started);
    }
    durations.sort((a, b) => a - b);
    const percentile = (p: number) => durations[Math.ceil(p * durations.length) - 1];
    results.push({
      candidate,
      samples: durations.length,
      p50Ms: percentile(0.5),
      p95Ms: percentile(0.95),
      p99Ms: percentile(0.99),
      maxMs: durations.at(-1),
    });
  }
  const decisions = await db.incidentAutomationDecision.findMany({
    where: { serviceId: service.id },
  });
  expect(decisions).toHaveLength(80);
  expect(
    decisions.every(decision => decision.versionId === active.id && decision.mode === 'LIVE')
  ).toBe(true);
  expect(
    new Set(decisions.map(decision => `${decision.routeType}:${decision.finalPriority}`)).size
  ).toBe(1);
  await mkdir('artifacts/automation-ui', { recursive: true });
  await writeFile(
    'artifacts/automation-ui/candidate-latency.json',
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        node: process.version,
        platform: platform(),
        arch: arch(),
        cpu: cpus()[0]?.model,
        logicalCpus: cpus().length,
        candidate: { fields: 64, rules: 100, conditionsPerRule: 20, actionsPerRule: 8 },
        cooperativeBudgetMs: LIMITS.evaluationMs,
        results,
        scope:
          'Sequential full PostgreSQL ingestion calls; includes transaction and surrounding application work, not isolated SQL transaction timing or HTTP latency.',
        acceptance:
          'Functional LIVE isolation passed. Deployment-specific latency acceptance and concurrent load/HA remain pending; the cooperative guard cannot preempt synchronous work.',
      },
      null,
      2
    )
  );
}, 120000);
