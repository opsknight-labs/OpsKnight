import { processAutomationJob } from '@/lib/automation/jobs';
import { beforeEach, expect, it } from 'vitest';
import {
  resetDatabase,
  testPrisma as db,
  createTestUser,
  createTestService,
} from '../helpers/test-db';
import {
  saveDraft,
  publishVersion,
  changeMode,
  activateCandidate,
} from '@/lib/automation/versioning';
import {
  prepareAutomation,
  persistAutomation,
  type IntegrationEventEnvelope,
} from '@/lib/automation/runtime';
import type { Snapshot } from '@/lib/automation/contract';

const snapshot = (suppress: boolean): Snapshot => ({
  schemaVersion: 1,
  fields: [],
  rules: [
    {
      id: 'route',
      name: 'Route',
      phase: 'ROUTE',
      enabled: true,
      conditions: [{ fieldKey: 'source', operator: 'EQ', value: 'comparison-fixture' }],
      actions: [{ type: suppress ? 'NO_ESCALATION' : 'USE_SERVICE_DEFAULT' }],
    },
  ],
});
beforeEach(async () => {
  await resetDatabase();
  await db.systemSettings.upsert({
    where: { id: 'default' },
    create: { automationEnabled: true },
    update: { automationEnabled: true },
  });
});
it.each([
  [true, true, 0],
  [false, true, 1],
  [true, false, 1],
] as const)(
  'persists suppression comparisons for LIVE=%s candidate=%s without changing LIVE routing',
  async (liveSuppressed, candidateSuppressed, differences) => {
    const actor = await createTestUser({ role: 'ADMIN' });
    const service = await createTestService('Suppression comparison');
    const first = await saveDraft({
      serviceId: service.id,
      actorId: actor.id,
      expectedRevision: 0,
      snapshot: snapshot(liveSuppressed),
    });
    const active = await publishVersion({
      serviceId: service.id,
      actorId: actor.id,
      expectedRevision: first.revision,
      expectedActiveVersionId: null,
    });
    await changeMode({
      serviceId: service.id,
      actorId: actor.id,
      mode: 'LIVE',
      expectedActiveVersionId: active.id,
      acknowledgeNoShadow: true,
    });
    const second = await saveDraft({
      serviceId: service.id,
      actorId: actor.id,
      expectedRevision: first.revision,
      snapshot: snapshot(candidateSuppressed),
    });
    const candidate = await publishVersion({
      serviceId: service.id,
      actorId: actor.id,
      expectedRevision: second.revision,
      expectedActiveVersionId: active.id,
    });
    const event = {
      event_action: 'trigger' as const,
      dedup_key: 'comparison',
      payload: { summary: 'Comparison', source: 'comparison-fixture', severity: 'info' as const },
    };
    const envelope: IntegrationEventEnvelope = {
      serviceId: service.id,
      integrationId: 'comparison',
      integrationType: 'EVENTS_API_V2',
      event,
      providerPayload: event,
      receivedAt: new Date(),
    };
    const incident = await db.incident.create({
      data: { serviceId: service.id, title: 'Comparison' },
    });
    await db.$transaction(async tx => {
      const runtime = await prepareAutomation(tx, envelope, { priority: 'P3', urgency: 'LOW' });
      expect(runtime?.candidateFallbackReason).toBeFalsy();
      expect(runtime?.candidateShadow).toMatchObject({
        noEscalationDifferent: differences,
        routeDifferent: differences,
        same: 1 - differences,
      });
      expect(runtime?.result?.outcome.type).toBe(
        liveSuppressed ? 'NO_ESCALATION' : 'SERVICE_DEFAULT'
      );
      await persistAutomation(tx, incident.id, envelope, runtime, false);
    });
    const job = await db.backgroundJob.findUniqueOrThrow({
      where: { id: `AUTOMATION_OBSERVE:${incident.id}` },
    });
    expect(job.payload).toMatchObject({
      shadow: {
        versionId: candidate.id,
        noEscalationDifferent: differences,
        same: 1 - differences,
      },
    });
    await processAutomationJob(job.payload);
    const aggregate = await db.automationShadowAggregate.findFirstOrThrow({
      where: { serviceId: service.id, versionId: candidate.id },
    });
    expect(aggregate).toMatchObject({
      evaluated: 1,
      same: 1 - differences,
      routeDifferent: differences,
      noEscalationDifferent: differences,
    });
    await db.backgroundJob.update({
      where: { id: job.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    // This regression isolates comparison semantics; representative-volume policy is tested separately.
    await db.systemSettings.update({
      where: { id: 'default' },
      data: {
        automationReadinessPolicy: {
          minimumEvaluations: 1,
          maximumEvidenceAgeHours: 48,
          maximumPendingObservations: 0,
          maximumErrorRate: 0,
        },
      },
    });
    const activate = () =>
      activateCandidate({
        serviceId: service.id,
        actorId: actor.id,
        expectedCandidateVersionId: candidate.id,
        expectedActiveVersionId: active.id,
      });
    if (differences) await expect(activate()).rejects.toThrow(/difference/i);
    else await expect(activate()).resolves.toBeDefined();
  }
);
