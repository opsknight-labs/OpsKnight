import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  testPrisma as db,
  resetDatabase,
  createTestUser,
  createTestService,
  createTestIncident,
} from '../helpers/test-db';
import { commitEscalationPlan } from '@/lib/escalation/repository';
import { syncUserNotificationEndpoint } from '@/lib/user-notification-endpoints';
import { applyIncidentLifecycleCommand } from '@/lib/incidents/lifecycle';
import { logger } from '@/lib/logger';

const fault = vi.hoisted(() => ({ afterIntents: false }));
vi.mock('@/lib/escalation/notification-intents', async original => {
  const actual = await original<typeof import('@/lib/escalation/notification-intents')>();
  return {
    ...actual,
    materializeEscalationNotificationIntents: async (
      ...args: Parameters<typeof actual.materializeEscalationNotificationIntents>
    ) => {
      const result = await actual.materializeEscalationNotificationIntents(...args);
      if (fault.afterIntents) throw new Error('Injected failure after durable pages');
      return result;
    },
  };
});
beforeEach(async () => {
  fault.afterIntents = false;
  await resetDatabase();
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => db.$disconnect());

async function fixture(count = 1) {
  const recipient = await createTestUser({ emailNotificationsEnabled: true });
  const service = await createTestService('Escalation commit concurrency');
  await syncUserNotificationEndpoint({
    userId: recipient.id,
    channel: 'EMAIL',
    address: recipient.email,
  });
  const token = new Date();
  const incidents = await Promise.all(
    Array.from({ length: count }, (_, index) =>
      createTestIncident(`Commit ${index}`, service.id, {
        escalationGeneration: 1,
        currentEscalationStep: 0,
        escalationStatus: 'ESCALATING',
        escalationProcessingAt: token,
        nextEscalationAt: token,
      })
    )
  );
  const input = (
    incident: (typeof incidents)[number]
  ): Parameters<typeof commitEscalationPlan>[0] => ({
    incidentId: incident.id,
    generation: 1,
    expectedStep: 0,
    workerToken: token,
    plan: {
      outcome: 'STEP_EXECUTED',
      assignment: { type: 'USER', userId: recipient.id },
      notificationRecipients: [recipient.id],
      timelineEvents: [{ type: 'ESCALATED', message: 'Responder page durably committed' }],
      nextState: {
        status: 'ESCALATING',
        currentStep: 1,
        nextEscalationAt: new Date(token.getTime() + 3600000),
      },
      nextJob: { stepIndex: 1, scheduledAt: new Date(token.getTime() + 3600000) },
    },
    notifications: {
      incidentId: incident.id,
      eventKey: `escalation:${incident.id}:1:0`,
      generation: 1,
      stepIndex: 0,
      eventAt: incident.createdAt,
      durableMessage: 'Escalation responder page',
      displayMessage: 'Respond to this incident',
      intents: [
        {
          notificationId: `page-${incident.id}`,
          userId: recipient.id,
          channel: 'EMAIL',
          recipientAddress: recipient.email,
        },
      ],
      inAppUserIds: [recipient.id],
      unreachableUserIds: [],
      controlPlane: true,
    },
  });
  return { recipient, incidents, input };
}

it('admits one concurrent worker and commits one assignment, timeline and durable page', async () => {
  const f = await fixture();
  const incident = f.incidents[0];
  const results = await Promise.all([
    commitEscalationPlan(f.input(incident)),
    commitEscalationPlan(f.input(incident)),
  ]);
  expect(results.filter(result => result.committed)).toHaveLength(1);
  expect(await db.notification.count({ where: { incidentId: incident.id } })).toBe(1);
  expect(await db.inAppNotification.count({ where: { entityId: incident.id } })).toBe(1);
  expect(await db.incidentEvent.count({ where: { incidentId: incident.id } })).toBe(1);
  expect(await db.backgroundJob.count({ where: { type: 'ESCALATION' } })).toBe(1);
  expect(await db.incident.findUniqueOrThrow({ where: { id: incident.id } })).toMatchObject({
    assigneeId: f.recipient.id,
    escalationStatus: 'ESCALATING',
    currentEscalationStep: 1,
    escalationProcessingAt: null,
  });
});

it('observes an acknowledgment committed while the escalation worker waits on the incident', async () => {
  const f = await fixture();
  const incident = f.incidents[0];
  let release!: () => void;
  const held = new Promise<void>(resolve => {
    release = resolve;
  });
  let acquired!: () => void;
  const ready = new Promise<void>(resolve => {
    acquired = resolve;
  });
  const acknowledgment = db.$transaction(
    async tx => {
      await tx.$queryRaw`SELECT id FROM "Incident" WHERE id=${incident.id} FOR UPDATE`;
      await applyIncidentLifecycleCommand(tx, {
        incidentId: incident.id,
        command: 'ACKNOWLEDGE',
        source: 'SYSTEM',
      });
      acquired();
      await held;
    },
    { timeout: 10000 }
  );
  await ready;
  const escalation = commitEscalationPlan(f.input(incident));
  try {
    let waiting = 0;
    for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
      const rows = await db.$queryRaw<
        Array<{ count: bigint }>
      >`SELECT count(*)::bigint AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND pid<>pg_backend_pid()`;
      waiting = Number(rows[0].count);
      if (!waiting) await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(waiting).toBeGreaterThan(0);
  } finally {
    release();
    await acknowledgment;
  }
  expect(await escalation).toEqual({ committed: false });
  expect(await db.notification.count({ where: { incidentId: incident.id } })).toBe(0);
  expect(
    await db.inAppNotification.count({ where: { entityId: incident.id, title: 'Action Required' } })
  ).toBe(0);
  expect(await db.incident.findUniqueOrThrow({ where: { id: incident.id } })).toMatchObject({
    status: 'ACKNOWLEDGED',
    escalationStatus: 'COMPLETED',
    escalationProcessingAt: null,
  });
});

it('rolls back pages, assignment, timeline and state when materialization fails after writing intents', async () => {
  const f = await fixture();
  const incident = f.incidents[0];
  fault.afterIntents = true;
  await expect(commitEscalationPlan(f.input(incident))).rejects.toThrow('Injected failure');
  expect(await db.notification.count({ where: { incidentId: incident.id } })).toBe(0);
  expect(await db.inAppNotification.count({ where: { entityId: incident.id } })).toBe(0);
  expect(await db.incidentEvent.count({ where: { incidentId: incident.id } })).toBe(0);
  expect(await db.backgroundJob.count({ where: { type: 'ESCALATION' } })).toBe(0);
  expect(await db.incident.findUniqueOrThrow({ where: { id: incident.id } })).toMatchObject({
    assigneeId: null,
    escalationStatus: 'ESCALATING',
    currentEscalationStep: 0,
    escalationProcessingAt: incident.escalationProcessingAt,
  });
});

it('commits independent incidents sharing a recipient without serialization retries or duplicate pages', async () => {
  const f = await fixture(40);
  const warnings = vi.spyOn(logger, 'warn');
  for (let offset = 0; offset < f.incidents.length; offset += 8) {
    const results = await Promise.all(
      f.incidents.slice(offset, offset + 8).map(incident => commitEscalationPlan(f.input(incident)))
    );
    expect(results.every(result => result.committed)).toBe(true);
  }
  expect(
    warnings.mock.calls.filter(([message]) => message === 'db.transaction.retry')
  ).toHaveLength(0);
  expect(await db.notification.count()).toBe(40);
  expect(await db.inAppNotification.count()).toBe(40);
  expect(await db.backgroundJob.count({ where: { type: 'ESCALATION' } })).toBe(40);
  expect(
    await db.incident.count({
      where: {
        assigneeId: f.recipient.id,
        escalationStatus: 'ESCALATING',
        currentEscalationStep: 1,
      },
    })
  ).toBe(40);
});
