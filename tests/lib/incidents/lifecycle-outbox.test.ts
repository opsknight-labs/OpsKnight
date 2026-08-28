import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  enqueueIncidentCreationSideEffects,
  enqueueLifecycleSideEffects,
  getIncidentCreationSideEffects,
  getLifecycleSideEffects,
} from '@/lib/event-outbox';

const DB_NOW = new Date('2026-08-28T07:00:00.000Z');

function createTx() {
  return {
    $queryRaw: vi.fn().mockResolvedValue([{ now: DB_NOW }]),
    backgroundJob: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn().mockResolvedValue({ id: 'job-unsnooze' }),
    },
  };
}

function asTransactionClient(tx: ReturnType<typeof createTx>) {
  return tx as unknown as Parameters<typeof enqueueLifecycleSideEffects>[0];
}

describe('durable lifecycle outbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps operator acknowledgement to durable notification, status, webhook, and war-room lanes', () => {
    expect(
      getLifecycleSideEffects({
        command: 'ACKNOWLEDGE',
        source: 'WEB',
        status: 'ACKNOWLEDGED',
      })
    ).toEqual([
      'LIFECYCLE_STATUS_PAGE',
      'LIFECYCLE_WEBHOOK',
      'LIFECYCLE_USER_NOTIFICATION',
      'LIFECYCLE_WAR_ROOM_SYNC',
    ]);
  });

  it('keeps event ingestion on its existing outbox owner to avoid duplicate ACK/RESOLVE jobs', () => {
    expect(
      getLifecycleSideEffects({
        command: 'RESOLVE',
        source: 'EVENT',
        status: 'RESOLVED',
      })
    ).toEqual([]);
  });

  it('persists lifecycle jobs with one database ordering timestamp and immutable transition context', async () => {
    const tx = createTx();
    await enqueueLifecycleSideEffects(asTransactionClient(tx), {
      incidentId: 'inc-1',
      command: 'RESOLVE',
      source: 'REST_API',
      previousStatus: 'ACKNOWLEDGED',
      status: 'RESOLVED',
      transitionAt: new Date('2026-08-28T06:59:59.000Z'),
    });

    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(tx.backgroundJob.createMany).toHaveBeenCalledOnce();
    const call = tx.backgroundJob.createMany.mock.calls[0]?.[0];
    expect(call?.data).toHaveLength(3);
    expect(call?.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'SCHEDULED_TASK',
          status: 'PENDING',
          scheduledAt: DB_NOW,
          payload: expect.objectContaining({
            task: 'EVENT_SIDE_EFFECT',
            incidentId: 'inc-1',
            eventOrderAt: DB_NOW.toISOString(),
            lifecycle: {
              command: 'RESOLVE',
              source: 'REST_API',
              previousStatus: 'ACKNOWLEDGED',
              status: 'RESOLVED',
              transitionAt: '2026-08-28T06:59:59.000Z',
              snoozedUntil: null,
            },
          }),
        }),
      ])
    );
    expect(
      call?.data.every(
        (job: { payload: { eventOrderAt: string } }) =>
          job.payload.eventOrderAt === DB_NOW.toISOString()
      )
    ).toBe(true);
  });

  it('persists finite auto-unsnooze timing in the same transaction as snooze effects', async () => {
    const tx = createTx();
    const snoozedUntil = new Date('2026-08-28T08:00:00.000Z');

    await enqueueLifecycleSideEffects(asTransactionClient(tx), {
      incidentId: 'inc-snooze',
      command: 'SNOOZE',
      source: 'CHATOPS',
      previousStatus: 'OPEN',
      status: 'SNOOZED',
      transitionAt: DB_NOW,
      snoozedUntil,
    });

    expect(tx.backgroundJob.createMany).toHaveBeenCalledOnce();
    expect(tx.backgroundJob.create).toHaveBeenCalledWith({
      data: {
        type: 'AUTO_UNSNOOZE',
        status: 'PENDING',
        scheduledAt: snoozedUntil,
        maxAttempts: 3,
        payload: { incidentId: 'inc-snooze' },
      },
    });
  });

  it('does not create generic lifecycle work for event resolve because events.ts already enqueues it', async () => {
    const tx = createTx();

    await enqueueLifecycleSideEffects(asTransactionClient(tx), {
      incidentId: 'inc-event',
      command: 'RESOLVE',
      source: 'EVENT',
      previousStatus: 'OPEN',
      status: 'RESOLVED',
      transitionAt: DB_NOW,
    });

    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.backgroundJob.createMany).not.toHaveBeenCalled();
    expect(tx.backgroundJob.create).not.toHaveBeenCalled();
  });
});

describe('durable incident creation outbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preserves interactive creation effects while making them durable', () => {
    expect(getIncidentCreationSideEffects({ source: 'WEB' })).toEqual([
      'TRIGGER_ESCALATION_NOTIFICATIONS',
      'TRIGGER_STATUS_PAGE',
      'TRIGGER_WAR_ROOM',
      'TRIGGER_JIRA',
    ]);
    expect(getIncidentCreationSideEffects({ source: 'MOBILE' })).toEqual([
      'TRIGGER_ESCALATION_NOTIFICATIONS',
      'TRIGGER_STATUS_PAGE',
      'TRIGGER_WAR_ROOM',
      'TRIGGER_JIRA',
    ]);
  });

  it('preserves REST created-webhook behavior without adding Jira automation', () => {
    expect(getIncidentCreationSideEffects({ source: 'REST_API' })).toEqual([
      'TRIGGER_WEBHOOK',
      'TRIGGER_ESCALATION_NOTIFICATIONS',
      'TRIGGER_STATUS_PAGE',
      'TRIGGER_WAR_ROOM',
    ]);
  });

  it('persists creation effects using one database ordering timestamp', async () => {
    const tx = createTx();

    await enqueueIncidentCreationSideEffects(asTransactionClient(tx), {
      incidentId: 'inc-created',
      source: 'WEB',
    });

    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(tx.backgroundJob.createMany).toHaveBeenCalledOnce();
    const call = tx.backgroundJob.createMany.mock.calls[0]?.[0];
    expect(call?.data).toHaveLength(4);
    expect(call?.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'SCHEDULED_TASK',
          status: 'PENDING',
          scheduledAt: DB_NOW,
          payload: expect.objectContaining({
            task: 'EVENT_SIDE_EFFECT',
            incidentId: 'inc-created',
            eventOrderAt: DB_NOW.toISOString(),
          }),
        }),
      ])
    );
  });
});
