import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  enqueueIncidentCreationSideEffects,
  enqueueLifecycleSideEffects,
  getIncidentCreationSideEffects,
  getLifecycleSideEffects,
} from '@/lib/event-outbox';
const DB_NOW = new Date('2026-08-30T13:00:00.000Z');
function createTx() {
  return {
    $queryRaw: vi.fn().mockResolvedValue([{ now: DB_NOW }]),
    incident: { findUnique: vi.fn() },
    backgroundJob: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn().mockResolvedValue({ id: 'job-1' }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      findFirst: vi.fn().mockResolvedValue(null),
    },
  };
}
function txClient(tx: ReturnType<typeof createTx>) {
  return tx as unknown as Parameters<typeof enqueueLifecycleSideEffects>[0];
}
describe('unified lifecycle delivery matrix', () => {
  beforeEach(() => vi.clearAllMocks());
  it.each(['WEB', 'MOBILE', 'REST_API', 'BULK', 'EVENT'] as const)(
    '%s ACK persists personal and service notification effects',
    source => {
      expect(
        getLifecycleSideEffects({ command: 'ACKNOWLEDGE', source, status: 'ACKNOWLEDGED' })
      ).toEqual(
        expect.arrayContaining([
          'LIFECYCLE_USER_NOTIFICATION',
          'LIFECYCLE_SERVICE_NOTIFICATION',
          'LIFECYCLE_STATUS_PAGE',
          'LIFECYCLE_WEBHOOK',
        ])
      );
    }
  );
  it('EVENT resolve no longer opts out of the canonical lifecycle owner', () => {
    expect(
      getLifecycleSideEffects({ command: 'RESOLVE', source: 'EVENT', status: 'RESOLVED' })
    ).toEqual(
      expect.arrayContaining([
        'LIFECYCLE_USER_NOTIFICATION',
        'LIFECYCLE_SERVICE_NOTIFICATION',
        'LIFECYCLE_STATUS_PAGE',
        'LIFECYCLE_WEBHOOK',
        'LIFECYCLE_WAR_ROOM_ARCHIVE',
      ])
    );
  });
  it('persists REST resolve fan-out with one immutable lifecycle context', async () => {
    const tx = createTx();
    await enqueueLifecycleSideEffects(txClient(tx), {
      incidentId: 'inc-1',
      command: 'RESOLVE',
      source: 'REST_API',
      previousStatus: 'ACKNOWLEDGED',
      status: 'RESOLVED',
      transitionAt: new Date('2026-08-30T12:59:59.000Z'),
    });
    const call = tx.backgroundJob.createMany.mock.calls[0]?.[0];
    expect(call?.data).toHaveLength(5);
    expect(call?.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({
            task: 'EVENT_SIDE_EFFECT',
            incidentId: 'inc-1',
            eventOrderAt: DB_NOW.toISOString(),
            lifecycle: expect.objectContaining({
              source: 'REST_API',
              status: 'RESOLVED',
              transitionAt: '2026-08-30T12:59:59.000Z',
            }),
          }),
        }),
      ])
    );
  });
  it('reopen replaces stale escalation work with the canonical generation', async () => {
    const tx = createTx();
    const nextEscalationAt = new Date('2026-08-30T13:05:00.000Z');
    tx.incident.findUnique.mockResolvedValue({
      status: 'OPEN',
      escalationStatus: 'ESCALATING',
      currentEscalationStep: 0,
      nextEscalationAt,
      escalationGeneration: 4,
    });
    await enqueueLifecycleSideEffects(txClient(tx), {
      incidentId: 'inc-reopen',
      command: 'REOPEN',
      source: 'WEB',
      previousStatus: 'RESOLVED',
      status: 'OPEN',
      transitionAt: DB_NOW,
    });
    expect(tx.backgroundJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'CANCELLED' }) })
    );
    expect(tx.backgroundJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'ESCALATION',
          scheduledAt: nextEscalationAt,
          // The job names the run it belongs to, so a worker can verify it.
          payload: expect.objectContaining({
            generation: 4,
            stepIndex: 0,
            logicalKey: 'ESCALATION:inc-reopen:4:0',
          }),
        }),
      })
    );
  });

  it.each(['UNACKNOWLEDGE', 'UNSNOOZE', 'UNSUPPRESS'] as const)(
    '%s arms its resumed escalation job in the same transaction',
    async command => {
      const tx = createTx();
      const nextEscalationAt = new Date('2026-08-30T13:20:00.000Z');
      tx.incident.findUnique.mockResolvedValue({
        status: 'OPEN',
        escalationStatus: 'ESCALATING',
        // A resume continues from the cursor the pause preserved.
        currentEscalationStep: 2,
        nextEscalationAt,
        escalationGeneration: 7,
      });

      await enqueueLifecycleSideEffects(txClient(tx), {
        incidentId: 'inc-resume',
        command,
        source: 'WEB',
        previousStatus: command === 'UNACKNOWLEDGE' ? 'ACKNOWLEDGED' : 'SNOOZED',
        status: 'OPEN',
        transitionAt: DB_NOW,
      });

      // Previously only REOPEN did this; the other three left the due state for
      // a scanner to discover.
      expect(tx.backgroundJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'CANCELLED' }) })
      );
      expect(tx.backgroundJob.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'ESCALATION',
            scheduledAt: nextEscalationAt,
            payload: expect.objectContaining({ generation: 7, stepIndex: 2 }),
          }),
        })
      );
    }
  );

  it.each(['ACKNOWLEDGE', 'RESOLVE', 'SNOOZE', 'SUPPRESS'] as const)(
    '%s arms no escalation job',
    async command => {
      const tx = createTx();
      tx.incident.findUnique.mockResolvedValue({
        status: command === 'SNOOZE' ? 'SNOOZED' : 'ACKNOWLEDGED',
        escalationStatus: command === 'SNOOZE' ? 'PAUSED' : 'COMPLETED',
        currentEscalationStep: 1,
        nextEscalationAt: null,
        escalationGeneration: 3,
      });

      await enqueueLifecycleSideEffects(txClient(tx), {
        incidentId: 'inc-stop',
        command,
        source: 'WEB',
        previousStatus: 'OPEN',
        status: command === 'SNOOZE' ? 'SNOOZED' : 'ACKNOWLEDGED',
        transitionAt: DB_NOW,
        ...(command === 'SNOOZE' ? { snoozedUntil: new Date('2026-08-30T14:00:00.000Z') } : {}),
      });

      const escalationJobs = tx.backgroundJob.create.mock.calls.filter(
        ([args]) => (args as { data: { type: string } }).data.type === 'ESCALATION'
      );
      expect(escalationJobs).toHaveLength(0);
    }
  );
});

it('keeps personal delivery independent from a blocked service-integration lane', async () => {
  const tx = createTx();
  await enqueueLifecycleSideEffects(txClient(tx), {
    incidentId: 'inc-lanes',
    command: 'RESOLVE',
    source: 'WEB',
    previousStatus: 'ACKNOWLEDGED',
    status: 'RESOLVED',
    transitionAt: DB_NOW,
  });
  const jobs = tx.backgroundJob.createMany.mock.calls[0]?.[0]?.data as
    | Array<{ payload: { effect: string; lane: string } }>
    | undefined;
  const personal = jobs?.find(job => job.payload.effect === 'LIFECYCLE_USER_NOTIFICATION');
  const service = jobs?.find(job => job.payload.effect === 'LIFECYCLE_SERVICE_NOTIFICATION');
  expect(personal?.payload.lane).toBe('PERSONAL_NOTIFICATION');
  expect(service?.payload.lane).toBe('SERVICE_NOTIFICATION');
});
describe('incident creation outbox', () => {
  it('separates service delivery from responder escalation for every creation source', () => {
    expect(getIncidentCreationSideEffects({ source: 'WEB' })).toEqual([
      'TRIGGER_ESCALATION_NOTIFICATIONS',
      'TRIGGER_SERVICE_NOTIFICATION',
      'TRIGGER_STATUS_PAGE',
      'TRIGGER_WAR_ROOM',
      'TRIGGER_JIRA',
    ]);
    expect(getIncidentCreationSideEffects({ source: 'REST_API' })).toEqual([
      'TRIGGER_WEBHOOK',
      'TRIGGER_ESCALATION_NOTIFICATIONS',
      'TRIGGER_SERVICE_NOTIFICATION',
      'TRIGGER_STATUS_PAGE',
      'TRIGGER_WAR_ROOM',
    ]);
  });
  it('persists the expanded creation fan-out at one database order instant', async () => {
    const tx = createTx();
    await enqueueIncidentCreationSideEffects(txClient(tx), {
      incidentId: 'inc-created',
      source: 'WEB',
    });
    const call = tx.backgroundJob.createMany.mock.calls[0]?.[0];
    expect(call?.data).toHaveLength(5);
    expect(call?.data.every((job: { scheduledAt: Date }) => job.scheduledAt === DB_NOW)).toBe(true);
  });
});

it('orders initial responder paging ahead of later personal lifecycle delivery', async () => {
  const tx = createTx();
  await enqueueIncidentCreationSideEffects(txClient(tx), {
    incidentId: 'inc-created',
    source: 'WEB',
  });
  const jobs = tx.backgroundJob.createMany.mock.calls[0]?.[0]?.data as
    | Array<{ payload: { effect: string; lane: string } }>
    | undefined;
  expect(
    jobs?.find(job => job.payload.effect === 'TRIGGER_ESCALATION_NOTIFICATIONS')?.payload.lane
  ).toBe('PERSONAL_NOTIFICATION');
  expect(
    jobs?.find(job => job.payload.effect === 'TRIGGER_SERVICE_NOTIFICATION')?.payload.lane
  ).toBe('SERVICE_NOTIFICATION');
});
