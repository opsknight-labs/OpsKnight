import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import { computeDefinitionChecksum, parseRunbookDefinition } from '@/lib/runbooks/definition';
import { processVerifiedResolution, recordRecoveryVerification } from '@/lib/runbooks/recovery';
import { processRunbookJob } from '@/lib/runbooks/orchestrator';
import { applyIncidentLifecycleCommand } from '@/lib/incidents/lifecycle';
import { claimEscalationStep } from '@/lib/escalation/repository';
import type { RunbookDefinition } from '@/lib/runbooks/types';
import {
  createTestIncident,
  createTestService,
  resetDatabase,
  testPrisma,
} from '../helpers/test-db';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

const REMEDIATION: RunbookDefinition = {
  steps: [
    {
      key: 'start',
      name: 'Start api',
      type: 'SYSTEMD',
      riskClass: 'IDEMPOTENT_WRITE',
      config: { action: 'start', unit: 'api.service' },
      verification: {
        steps: [
          {
            key: 'verify',
            name: 'Check api',
            type: 'SYSTEMD',
            riskClass: 'READ_ONLY',
            config: { action: 'status', unit: 'api.service' },
          },
        ],
      },
    },
  ],
};

const DIAGNOSTICS: RunbookDefinition = {
  steps: [
    {
      key: 'inspect',
      name: 'Inspect api',
      type: 'SYSTEMD',
      riskClass: 'READ_ONLY',
      config: { action: 'status', unit: 'api.service' },
    },
  ],
};

type Fixture = Awaited<ReturnType<typeof createFixture>>;

async function createFixture(
  options: {
    definition?: RunbookDefinition;
    resolveOnVerifiedRecovery?: boolean;
    noEscalation?: boolean;
  } = {}
) {
  const definition = options.definition ?? REMEDIATION;
  const runbook = await testPrisma.runbook.create({
    data: { name: `Recover api ${crypto.randomUUID()}`, slug: `recover-${crypto.randomUUID()}` },
  });
  const parsed = parseRunbookDefinition(definition as unknown as Prisma.InputJsonValue, []);
  const version = await testPrisma.runbookVersion.create({
    data: {
      runbookId: runbook.id,
      version: 1,
      state: 'PUBLISHED',
      publishedAt: new Date(),
      definition: parsed as unknown as Prisma.InputJsonValue,
      checksum: computeDefinitionChecksum(parsed),
    },
  });
  const service = await createTestService('Runbook recovery');
  const binding = await testPrisma.serviceAutomationRule.create({
    data: {
      serviceId: service.id,
      runbookId: runbook.id,
      runbookVersionId: version.id,
      enabled: true,
      mode: 'AUTOMATIC',
      versionStrategy: 'PINNED',
      resolveOnVerifiedRecovery: options.resolveOnVerifiedRecovery ?? false,
    },
  });
  const incident = await createTestIncident('API down', service.id, {
    escalationStatus: options.noEscalation ? 'COMPLETED' : 'ESCALATING',
    currentEscalationStep: options.noEscalation ? null : 0,
    nextEscalationAt: options.noEscalation ? null : new Date(Date.now() + 5 * 60_000),
  });
  if (options.noEscalation) {
    await testPrisma.incidentAutomationDecision.create({
      data: {
        incidentId: incident.id,
        serviceId: service.id,
        mode: 'LIVE',
        routeType: 'NO_ESCALATION',
        evaluationAt: new Date(),
        summary: {},
      },
    });
  } else {
    await testPrisma.backgroundJob.create({
      data: {
        type: 'ESCALATION',
        status: 'PENDING',
        scheduledAt: incident.nextEscalationAt!,
        maxAttempts: 3,
        payload: {
          incidentId: incident.id,
          stepIndex: 0,
          generation: incident.escalationGeneration,
        },
      },
    });
  }
  return { runbook, version, service, binding, incident, definition };
}

const verification = (verified: boolean) => ({
  verified,
  checkKeys: ['verify'],
  capturedAt: new Date().toISOString(),
  reason: verified ? 'api.service is active' : 'api.service is still failed',
  differences: [],
});

/** A terminal execution as the orchestrator leaves it after finalizeVerificationEvidence. */
async function terminalExecution(
  fixture: Fixture,
  options: {
    status?: 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT' | 'CANCELLED';
    verified?: boolean | null;
    failureCode?: string;
  } = {}
) {
  const status = options.status ?? 'SUCCEEDED';
  const now = new Date();
  const steps =
    fixture.definition === DIAGNOSTICS
      ? [
          {
            stepKey: 'inspect',
            sequence: 0,
            name: 'Inspect api',
            type: 'SYSTEMD' as const,
            riskClass: 'READ_ONLY' as const,
            status: status === 'SUCCEEDED' ? ('SUCCEEDED' as const) : ('FAILED' as const),
          },
        ]
      : [
          {
            stepKey: 'start',
            sequence: 0,
            name: 'Start api',
            type: 'SYSTEMD' as const,
            riskClass: 'IDEMPOTENT_WRITE' as const,
            status: 'SUCCEEDED' as const,
            ...(options.verified === null || options.verified === undefined
              ? {}
              : { verificationResult: verification(options.verified) }),
          },
          {
            stepKey: 'verify',
            sequence: 1,
            name: 'Check api',
            type: 'SYSTEMD' as const,
            riskClass: 'READ_ONLY' as const,
            status: status === 'SUCCEEDED' ? ('SUCCEEDED' as const) : ('FAILED' as const),
          },
        ];
  return testPrisma.runbookExecution.create({
    data: {
      runbookId: fixture.runbook.id,
      runbookVersionId: fixture.version.id,
      incidentId: fixture.incident.id,
      serviceId: fixture.service.id,
      bindingId: fixture.binding.id,
      status,
      triggeredByType: 'TRIGGER',
      startedAt: new Date(now.getTime() - 60_000),
      completedAt: now,
      failureCode: options.failureCode ?? null,
      deadlineAt: new Date(now.getTime() + 3_600_000),
      definitionChecksum: fixture.version.checksum,
      steps: { create: steps },
    },
  });
}

const record = (executionId: string) =>
  testPrisma.$transaction(tx => recordRecoveryVerification(tx, executionId));

const execution = (id: string) => testPrisma.runbookExecution.findUniqueOrThrow({ where: { id } });
const incidentOf = (id: string) => testPrisma.incident.findUniqueOrThrow({ where: { id } });
const events = (incidentId: string, type: Prisma.IncidentEventWhereInput['type']) =>
  testPrisma.incidentEvent.findMany({ where: { incidentId, type }, orderBy: { createdAt: 'asc' } });
const resolutionJobs = (executionId: string) =>
  testPrisma.backgroundJob.findMany({
    where: {
      type: 'RUNBOOK',
      AND: [
        { payload: { path: ['kind'], equals: 'VERIFIED_RESOLUTION' } },
        { payload: { path: ['executionId'], equals: executionId } },
      ],
    },
  });

async function claimStepZero(incidentId: string) {
  const incident = await incidentOf(incidentId);
  return claimEscalationStep({
    incidentId,
    stepIndex: 0,
    expectedGeneration: incident.escalationGeneration,
    now: new Date(),
    lockTimeoutMs: 60_000,
  });
}

describeIfRealDB('runbook recovery coordination (real PostgreSQL)', { timeout: 120_000 }, () => {
  beforeEach(async () => resetDatabase(), 240_000);
  afterAll(async () => testPrisma.$disconnect());

  it('resolves via the lifecycle with an audited SYSTEM actor and cancels pending escalation', async () => {
    const fixture = await createFixture({ resolveOnVerifiedRecovery: true });
    const run = await terminalExecution(fixture, { verified: true });

    expect(await record(run.id)).toMatchObject({ outcome: 'PENDING', event: 'RUNBOOK_VERIFIED' });
    // Recording never touches paging on its own.
    expect(await incidentOf(fixture.incident.id)).toMatchObject({
      status: 'OPEN',
      escalationStatus: 'ESCALATING',
    });
    const [job] = await resolutionJobs(run.id);
    expect(job).toBeDefined();
    await processRunbookJob(job.payload);

    const resolved = await incidentOf(fixture.incident.id);
    expect(resolved).toMatchObject({
      status: 'RESOLVED',
      resolutionKind: 'AUTOMATION',
      escalationStatus: 'COMPLETED',
      nextEscalationAt: null,
    });
    expect(await execution(run.id)).toMatchObject({ recoveryOutcome: 'RESOLVED' });
    const audit = await testPrisma.auditLog.findFirstOrThrow({
      where: { action: 'runbook.execution.recovery.resolved', entityId: run.id },
    });
    expect(audit.actorId).toBeNull();
    expect(await claimStepZero(fixture.incident.id)).toEqual({
      claimed: false,
      reason: 'SUPERSEDED',
    });
  });

  it('only recommends resolution when resolveOnVerifiedRecovery is off', async () => {
    const fixture = await createFixture();
    const run = await terminalExecution(fixture, { verified: true });
    await record(run.id);

    expect(await execution(run.id)).toMatchObject({ recoveryOutcome: 'NOT_REQUESTED' });
    const verified = await events(fixture.incident.id, 'RUNBOOK_VERIFIED');
    expect(verified).toHaveLength(1);
    expect(verified[0].message).toContain('Resolution recommended:');
    expect(await resolutionJobs(run.id)).toHaveLength(0);
    expect(await incidentOf(fixture.incident.id)).toMatchObject({
      status: 'OPEN',
      escalationStatus: 'ESCALATING',
    });
    expect(await claimStepZero(fixture.incident.id)).toMatchObject({ claimed: true });
  });

  it('keeps an unverified remediation open and escalating', async () => {
    const fixture = await createFixture({ resolveOnVerifiedRecovery: true });
    const run = await terminalExecution(fixture, { status: 'FAILED', verified: false });
    await record(run.id);

    expect(await execution(run.id)).toMatchObject({ recoveryOutcome: 'NOT_VERIFIED' });
    const unverified = await events(fixture.incident.id, 'RUNBOOK_UNVERIFIED');
    expect(unverified).toHaveLength(1);
    expect(unverified[0].message).toContain('escalation continues');
    expect(unverified[0].message).not.toContain('Human intervention required');
    expect(await events(fixture.incident.id, 'RUNBOOK_VERIFIED')).toHaveLength(0);
    expect(await resolutionJobs(run.id)).toHaveLength(0);
    expect(await incidentOf(fixture.incident.id)).toMatchObject({
      status: 'OPEN',
      escalationStatus: 'ESCALATING',
    });
    expect(await claimStepZero(fixture.incident.id)).toMatchObject({ claimed: true });
  });

  it('never treats a successful command without evidence as verification', async () => {
    const fixture = await createFixture({ resolveOnVerifiedRecovery: true });
    const run = await terminalExecution(fixture, { verified: null });
    await record(run.id);
    expect(await execution(run.id)).toMatchObject({ recoveryOutcome: 'NOT_VERIFIED' });
    expect(await events(fixture.incident.id, 'RUNBOOK_VERIFIED')).toHaveLength(0);
    expect(await resolutionJobs(run.id)).toHaveLength(0);
    expect((await incidentOf(fixture.incident.id)).status).toBe('OPEN');
  });

  it('records diagnostics without verification events while paging continues', async () => {
    const fixture = await createFixture({
      definition: DIAGNOSTICS,
      resolveOnVerifiedRecovery: true,
    });
    const run = await terminalExecution(fixture);
    await record(run.id);
    expect(await execution(run.id)).toMatchObject({ recoveryOutcome: 'NOT_REQUESTED' });
    expect(
      await testPrisma.incidentEvent.count({
        where: {
          incidentId: fixture.incident.id,
          type: { in: ['RUNBOOK_VERIFIED', 'RUNBOOK_UNVERIFIED'] },
        },
      })
    ).toBe(0);
    expect(await claimStepZero(fixture.incident.id)).toMatchObject({ claimed: true });
  });

  it('marks ALREADY_CLOSED when the incident was resolved during execution', async () => {
    const fixture = await createFixture({ resolveOnVerifiedRecovery: true });
    await testPrisma.$transaction(tx =>
      applyIncidentLifecycleCommand(tx, {
        incidentId: fixture.incident.id,
        command: 'RESOLVE',
        source: 'WEB',
        actor: { name: 'Alice' },
      })
    );
    const resolved = await incidentOf(fixture.incident.id);
    const run = await terminalExecution(fixture, { verified: true });
    await record(run.id);
    expect(await execution(run.id)).toMatchObject({ recoveryOutcome: 'ALREADY_CLOSED' });
    expect(await resolutionJobs(run.id)).toHaveLength(0);
    expect(await incidentOf(fixture.incident.id)).toMatchObject({
      status: 'RESOLVED',
      resolutionKind: 'MANUAL',
      resolvedAt: resolved.resolvedAt,
    });
  });

  it('blocks resolution after a conflicting resolve/reopen cycle and keeps paging', async () => {
    const fixture = await createFixture({ resolveOnVerifiedRecovery: true });
    const run = await terminalExecution(fixture, { verified: true });
    await record(run.id);
    for (const command of ['RESOLVE', 'REOPEN'] as const)
      await testPrisma.$transaction(tx =>
        applyIncidentLifecycleCommand(tx, {
          incidentId: fixture.incident.id,
          command,
          source: 'WEB',
          actor: { name: 'Alice' },
        })
      );
    expect(await processVerifiedResolution(run.id)).toBe('BLOCKED');
    expect(await execution(run.id)).toMatchObject({ recoveryOutcome: 'BLOCKED' });
    const skipped = await events(fixture.incident.id, 'RUNBOOK_SKIPPED');
    expect(skipped).toHaveLength(1);
    expect(skipped[0].message).toContain('no longer current');
    expect(await incidentOf(fixture.incident.id)).toMatchObject({
      status: 'OPEN',
      escalationStatus: 'ESCALATING',
    });
  });

  it('flags human intervention for a NO_ESCALATION incident whose remediation failed', async () => {
    const fixture = await createFixture({ noEscalation: true });
    const run = await terminalExecution(fixture, { status: 'FAILED', verified: false });
    await record(run.id);
    const unverified = await events(fixture.incident.id, 'RUNBOOK_UNVERIFIED');
    expect(unverified).toHaveLength(1);
    expect(unverified[0].message).toMatch(/^Human intervention required: /);
    // The pinned routing decision is not overridden.
    expect(
      await testPrisma.incidentAutomationDecision.findUniqueOrThrow({
        where: { incidentId: fixture.incident.id },
      })
    ).toMatchObject({ routeType: 'NO_ESCALATION' });
    expect(await incidentOf(fixture.incident.id)).toMatchObject({
      status: 'OPEN',
      escalationStatus: 'COMPLETED',
      nextEscalationAt: null,
    });
    expect(await testPrisma.backgroundJob.count({ where: { type: 'ESCALATION' } })).toBe(0);
  });

  it('flags human intervention for a NO_ESCALATION diagnostics failure without verification', async () => {
    const fixture = await createFixture({ definition: DIAGNOSTICS, noEscalation: true });
    const run = await terminalExecution(fixture, { status: 'TIMED_OUT' });
    await record(run.id);
    const unverified = await events(fixture.incident.id, 'RUNBOOK_UNVERIFIED');
    expect(unverified).toHaveLength(1);
    expect(unverified[0].message).toContain('timed out');
    expect(unverified[0].message).toMatch(/^Human intervention required: /);
  });

  it('does not flag human intervention for a verified NO_ESCALATION recovery', async () => {
    const fixture = await createFixture({ noEscalation: true });
    const run = await terminalExecution(fixture, { verified: true });
    await record(run.id);
    expect(await events(fixture.incident.id, 'RUNBOOK_UNVERIFIED')).toHaveLength(0);
    expect(await events(fixture.incident.id, 'RUNBOOK_VERIFIED')).toHaveLength(1);
  });

  it('is idempotent across repeated and concurrent recording and resolution', async () => {
    const fixture = await createFixture({ resolveOnVerifiedRecovery: true });
    const run = await terminalExecution(fixture, { verified: true });
    const results = await Promise.allSettled([record(run.id), record(run.id), record(run.id)]);
    expect(results.filter(result => result.status === 'fulfilled' && result.value)).toHaveLength(1);
    await record(run.id);
    expect(await events(fixture.incident.id, 'RUNBOOK_VERIFIED')).toHaveLength(1);
    expect(await resolutionJobs(run.id)).toHaveLength(1);
    expect(await processVerifiedResolution(run.id)).toBe('RESOLVED');
    expect(await processVerifiedResolution(run.id)).toBe('RESOLVED');
    expect(
      await testPrisma.incidentEvent.count({
        where: {
          incidentId: fixture.incident.id,
          message: { startsWith: 'Resolved after verified recovery' },
        },
      })
    ).toBe(1);

    const failed = await createFixture();
    const unverified = await terminalExecution(failed, { status: 'FAILED', verified: false });
    await record(unverified.id);
    await record(unverified.id);
    expect(await events(failed.incident.id, 'RUNBOOK_UNVERIFIED')).toHaveLength(1);
  });

  it('re-records a revised outcome only after the execution is terminalized again', async () => {
    const fixture = await createFixture();
    const run = await terminalExecution(fixture, { status: 'FAILED', verified: false });
    await record(run.id);
    // A late Agent result revives and re-terminalizes the execution with passing evidence.
    await testPrisma.runbookExecutionStep.updateMany({
      where: { executionId: run.id, stepKey: 'start' },
      data: { verificationResult: verification(true) },
    });
    await testPrisma.runbookExecutionStep.updateMany({
      where: { executionId: run.id, stepKey: 'verify' },
      data: { status: 'SUCCEEDED' },
    });
    await testPrisma.runbookExecution.update({
      where: { id: run.id },
      data: { status: 'SUCCEEDED', completedAt: new Date(Date.now() + 1_000) },
    });
    expect(await record(run.id)).toMatchObject({ event: 'RUNBOOK_VERIFIED' });
    expect(await record(run.id)).toBeNull();
    expect(await events(fixture.incident.id, 'RUNBOOK_VERIFIED')).toHaveLength(1);
    expect(await events(fixture.incident.id, 'RUNBOOK_UNVERIFIED')).toHaveLength(1);
  });
});
