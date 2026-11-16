import { afterAll, beforeEach, expect, it } from 'vitest';
import {
  testPrisma as db,
  resetDatabase,
  createTestUser,
  createTestService,
  createTestIncident,
} from '../helpers/test-db';
import prisma from '@/lib/prisma';
import { commitEscalationPlan, scheduleDelayedEscalationStep } from '@/lib/escalation/repository';
import type { EscalationStepAttemptRecord } from '@/lib/escalation/step-attempts';

// Every SQL statement the app client sends, BEGIN/COMMIT included.
const statements: string[] = [];
(prisma as unknown as { $on(event: 'query', cb: (e: { query: string }) => void): void }).$on(
  'query',
  event => statements.push(event.query)
);

beforeEach(() => resetDatabase());
afterAll(() => db.$disconnect());

async function measure<T>(run: () => Promise<T>): Promise<{ result: T; sql: string[] }> {
  // Query events are emitted asynchronously; let earlier ones drain first.
  await new Promise(resolve => setTimeout(resolve, 50));
  statements.length = 0;
  const result = await run();
  await new Promise(resolve => setTimeout(resolve, 50));
  // Only the transaction itself: a pool health check ("SELECT 1") can land in the window.
  const begin = statements.indexOf('BEGIN');
  return { result, sql: statements.slice(begin, statements.indexOf('COMMIT', begin) + 1) };
}

async function commitFixture() {
  const recipient = await createTestUser();
  const service = await createTestService('Attempt capture');
  const token = new Date();
  const incident = (title: string) =>
    createTestIncident(title, service.id, {
      escalationGeneration: 1,
      currentEscalationStep: 0,
      escalationStatus: 'ESCALATING',
      escalationProcessingAt: token,
      nextEscalationAt: token,
    });
  const input = (incidentId: string): Parameters<typeof commitEscalationPlan>[0] => ({
    incidentId,
    generation: 1,
    expectedStep: 0,
    workerToken: token,
    plan: {
      outcome: 'STEP_EXECUTED',
      assignment: null,
      notificationRecipients: [recipient.id],
      timelineEvents: [
        { type: 'ESCALATED', message: 'Escalated to Someone (Level 1)' },
        { type: 'ESCALATED', message: 'Next escalation step scheduled' },
      ],
      nextState: {
        status: 'ESCALATING',
        currentStep: 1,
        nextEscalationAt: new Date(token.getTime() + 3600000),
      },
      nextJob: { stepIndex: 1, scheduledAt: new Date(token.getTime() + 3600000) },
    },
  });
  const attempt: EscalationStepAttemptRecord = {
    policyId: 'policy-1',
    policyRevision: 7,
    targetType: 'USER',
    targetId: recipient.id,
    resolvedUserIds: [recipient.id],
    outcome: 'NOTIFIED',
    skipReason: null,
    notifiedAt: token,
  };
  return { recipient, incident, input, attempt, token };
}

it('captures the step attempt on the commit path without adding a statement', async () => {
  const f = await commitFixture();
  const plain = await f.incident('Without capture');
  const captured = await f.incident('With capture');

  const baseline = await measure(() => commitEscalationPlan(f.input(plain.id)));
  const withAttempt = await measure(() =>
    commitEscalationPlan({ ...f.input(captured.id), attempt: f.attempt })
  );

  expect(baseline.result.committed).toBe(true);
  expect(withAttempt.result.committed).toBe(true);
  expect(baseline.sql.length).toBeGreaterThan(0);
  expect(withAttempt.sql).toHaveLength(baseline.sql.length);
  // The attempt has no statement of its own, and nothing reads the table.
  const touching = withAttempt.sql.filter(sql => sql.includes('EscalationStepAttempt'));
  expect(touching).toHaveLength(1);
  expect(touching[0]).toContain('INSERT INTO "IncidentEvent"');

  expect(await db.escalationStepAttempt.count({ where: { incidentId: plain.id } })).toBe(0);
  expect(
    await db.escalationStepAttempt.findUniqueOrThrow({
      where: {
        incidentId_generation_stepIndex: { incidentId: captured.id, generation: 1, stepIndex: 0 },
      },
    })
  ).toMatchObject({
    policyId: 'policy-1',
    policyRevision: 7,
    targetType: 'USER',
    targetId: f.recipient.id,
    resolvedUserIds: [f.recipient.id],
    outcome: 'NOTIFIED',
    skipReason: null,
    notifiedAt: f.token,
    approximate: false,
  });

  // The timeline is unchanged: same events, same order.
  const events = await db.incidentEvent.findMany({
    where: { incidentId: captured.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { type: true, message: true },
  });
  expect(events).toEqual([
    { type: 'ESCALATED', message: 'Escalated to Someone (Level 1)' },
    { type: 'ESCALATED', message: 'Next escalation step scheduled' },
  ]);
});

it('writes nothing when a lifecycle transition already superseded the worker', async () => {
  const f = await commitFixture();
  const incident = await f.incident('Superseded');
  const result = await commitEscalationPlan({
    ...f.input(incident.id),
    workerToken: new Date(f.token.getTime() + 1),
    attempt: f.attempt,
  });
  expect(result.committed).toBe(false);
  expect(await db.escalationStepAttempt.count()).toBe(0);
  expect(await db.incidentEvent.count({ where: { incidentId: incident.id } })).toBe(0);
});

it('records a delayed step as SCHEDULED in the same statement, then overwrites it on execution', async () => {
  const f = await commitFixture();
  const service = await createTestService('Delayed capture');
  const armable = (title: string) => createTestIncident(title, service.id, {});
  const plain = await armable('Delayed without capture');
  const captured = await armable('Delayed with capture');
  const dueAt = new Date(Date.now() + 600000);
  const scheduled: EscalationStepAttemptRecord = {
    ...f.attempt,
    resolvedUserIds: [],
    outcome: 'SCHEDULED',
    notifiedAt: null,
  };
  const arm = (incidentId: string, attempt?: EscalationStepAttemptRecord) =>
    scheduleDelayedEscalationStep({
      incidentId,
      generation: 0,
      stepIndex: 0,
      delayMinutes: 10,
      dueAt,
      attempt,
    });

  const baseline = await measure(() => arm(plain.id));
  const withAttempt = await measure(() => arm(captured.id, scheduled));
  expect(baseline.result).toBe(true);
  expect(withAttempt.result).toBe(true);
  expect(withAttempt.sql).toHaveLength(baseline.sql.length);

  const key = {
    incidentId_generation_stepIndex: { incidentId: captured.id, generation: 0, stepIndex: 0 },
  };
  expect(await db.escalationStepAttempt.findUniqueOrThrow({ where: key })).toMatchObject({
    outcome: 'SCHEDULED',
    notifiedAt: null,
  });
  expect(await db.incidentEvent.count({ where: { incidentId: captured.id } })).toBe(1);

  // The due job claims the step, then commits the real outcome over the row.
  const token = new Date();
  await db.incident.update({
    where: { id: captured.id },
    data: { escalationProcessingAt: token },
  });
  const commit = await commitEscalationPlan({
    ...f.input(captured.id),
    generation: 0,
    workerToken: token,
    attempt: f.attempt,
  });
  expect(commit.committed).toBe(true);
  expect(await db.escalationStepAttempt.count({ where: { incidentId: captured.id } })).toBe(1);
  expect(await db.escalationStepAttempt.findUniqueOrThrow({ where: key })).toMatchObject({
    outcome: 'NOTIFIED',
    resolvedUserIds: [f.recipient.id],
  });
});
