import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runSerializableTransaction: vi.fn(),
  enqueueLifecycleSideEffects: vi.fn(),
}));

vi.mock('@/lib/db-utils', () => ({
  runSerializableTransaction: mocks.runSerializableTransaction,
}));

vi.mock('@/lib/event-outbox', () => ({
  enqueueLifecycleSideEffects: mocks.enqueueLifecycleSideEffects,
}));

import {
  applyIncidentLifecycleCommand,
  executeIncidentLifecycleBatch,
  executeIncidentLifecycleCommand,
} from '@/lib/incidents/lifecycle';

type Tx = {
  incident: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  customField: {
    findMany: ReturnType<typeof vi.fn>;
  };
  incidentNote: {
    create: ReturnType<typeof vi.fn>;
  };
  incidentEvent: {
    create: ReturnType<typeof vi.fn>;
  };
};

const NOW = new Date('2026-08-27T12:00:00.000Z');

function snapshot(
  overrides: Partial<{
    status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'SNOOZED' | 'SUPPRESSED';
    acknowledgedAt: Date | null;
    resolvedAt: Date | null;
    currentEscalationStep: number | null;
    snoozedUntil: Date | null;
    snoozeReason: string | null;
    createdAt: Date;
    slaPausedMs: bigint;
    slaPauseStartedAt: Date | null;
    slaAckElapsedMs: bigint | null;
    slaResolveElapsedMs: bigint | null;
  }> = {}
) {
  return {
    status: 'OPEN' as const,
    acknowledgedAt: null as Date | null,
    resolvedAt: null as Date | null,
    currentEscalationStep: 0 as number | null,
    snoozedUntil: null as Date | null,
    snoozeReason: null as string | null,
    createdAt: new Date('2026-08-27T11:40:00.000Z'),
    slaPausedMs: BigInt(0),
    slaPauseStartedAt: null as Date | null,
    slaAckElapsedMs: null as bigint | null,
    slaResolveElapsedMs: null as bigint | null,
    escalationGeneration: 0,
    service: {
      policy: {
        steps: [{ delayMinutes: 5 }, { delayMinutes: 10 }, { delayMinutes: 20 }],
      },
    },
    ...overrides,
  };
}

function createTx(): Tx {
  return {
    incident: {
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    customField: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    incidentNote: {
      create: vi.fn().mockResolvedValue({}),
    },
    incidentEvent: {
      create: vi.fn().mockResolvedValue({}),
    },
  };
}

function asTransactionClient(tx: Tx) {
  return tx as unknown as Parameters<typeof applyIncidentLifecycleCommand>[0];
}

describe('incident lifecycle command engine', () => {
  let tx: Tx;

  beforeEach(() => {
    vi.clearAllMocks();
    tx = createTx();
    mocks.enqueueLifecycleSideEffects.mockResolvedValue(undefined);
    mocks.runSerializableTransaction.mockImplementation(
      async (callback: (client: ReturnType<typeof asTransactionClient>) => Promise<unknown>) =>
        callback(asTransactionClient(tx))
    );
  });

  it('treats duplicate ACK as a no-op before stale expectedStatus checks', async () => {
    tx.incident.findUnique.mockResolvedValue(
      snapshot({ status: 'ACKNOWLEDGED', acknowledgedAt: new Date(NOW.getTime() - 60_000) })
    );

    const result = await applyIncidentLifecycleCommand(asTransactionClient(tx), {
      incidentId: 'inc-ack',
      command: 'ACKNOWLEDGE',
      source: 'WEB',
      expectedStatus: 'OPEN',
      now: NOW,
    });

    expect(result).toMatchObject({ incidentId: 'inc-ack', changed: false, status: 'ACKNOWLEDGED' });
    expect(tx.incident.update).not.toHaveBeenCalled();
    expect(mocks.enqueueLifecycleSideEffects).not.toHaveBeenCalled();
  });

  it('treats duplicate RESOLVE as a no-op without repeating validation, notes, or outbox work', async () => {
    tx.incident.findUnique.mockResolvedValue(
      snapshot({ status: 'RESOLVED', resolvedAt: new Date(NOW.getTime() - 60_000) })
    );

    const result = await applyIncidentLifecycleCommand(asTransactionClient(tx), {
      incidentId: 'inc-resolved',
      command: 'RESOLVE',
      source: 'WEB',
      expectedStatus: 'OPEN',
      actor: { id: 'user-1', name: 'Responder' },
      resolutionNote: 'Database failover completed successfully.',
      now: NOW,
    });

    expect(result.changed).toBe(false);
    expect(tx.customField.findMany).not.toHaveBeenCalled();
    expect(tx.incident.update).not.toHaveBeenCalled();
    expect(tx.incidentNote.create).not.toHaveBeenCalled();
    expect(tx.incidentEvent.create).not.toHaveBeenCalled();
    expect(mocks.enqueueLifecycleSideEffects).not.toHaveBeenCalled();
  });

  it('captures pause-adjusted ACK elapsed time atomically', async () => {
    tx.incident.findUnique.mockResolvedValue(snapshot({ slaPausedMs: BigInt(5 * 60_000) }));

    await applyIncidentLifecycleCommand(asTransactionClient(tx), {
      incidentId: 'inc-ack-clock', command: 'ACKNOWLEDGE', source: 'WEB', now: NOW,
    });

    expect(tx.incident.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ slaAckElapsedMs: BigInt(15 * 60_000) }),
    }));
  });

  it('captures resolve elapsed while an SLA pause is open', async () => {
    tx.incident.findUnique.mockResolvedValue(snapshot({
      createdAt: new Date('2026-08-27T11:00:00.000Z'),
      slaPausedMs: BigInt(10 * 60_000),
      slaPauseStartedAt: new Date('2026-08-27T11:50:00.000Z'),
    }));

    await applyIncidentLifecycleCommand(asTransactionClient(tx), {
      incidentId: 'inc-resolve-clock', command: 'RESOLVE', source: 'WEB', now: NOW,
    });

    expect(tx.incident.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        slaResolveElapsedMs: BigInt(40 * 60_000),
        slaPausedMs: { increment: BigInt(10 * 60_000) },
        slaPauseStartedAt: null,
      }),
    }));
  });

  it('rejects a stale expectedStatus for a real transition', async () => {
    tx.incident.findUnique.mockResolvedValue(snapshot({ status: 'ACKNOWLEDGED' }));

    await expect(
      applyIncidentLifecycleCommand(asTransactionClient(tx), {
        incidentId: 'inc-stale',
        command: 'RESOLVE',
        source: 'WEB',
        expectedStatus: 'OPEN',
        now: NOW,
      })
    ).rejects.toMatchObject({ code: 'INCIDENT_TRANSITION_CONFLICT', status: 409 });

    expect(tx.incident.update).not.toHaveBeenCalled();
    expect(mocks.enqueueLifecycleSideEffects).not.toHaveBeenCalled();
  });

  it('rejects RESOLVED to ACKNOWLEDGED without an explicit reopen', async () => {
    tx.incident.findUnique.mockResolvedValue(snapshot({ status: 'RESOLVED', resolvedAt: NOW }));

    await expect(
      applyIncidentLifecycleCommand(asTransactionClient(tx), {
        incidentId: 'inc-invalid',
        command: 'ACKNOWLEDGE',
        source: 'WEB',
        now: NOW,
      })
    ).rejects.toMatchObject({ code: 'INCIDENT_INVALID_TRANSITION', status: 409 });
  });

  it('reopens a resolved incident from escalation step zero using the first-step delay', async () => {
    tx.incident.findUnique.mockResolvedValue(
      snapshot({ status: 'RESOLVED', resolvedAt: NOW, currentEscalationStep: 2 })
    );

    await applyIncidentLifecycleCommand(asTransactionClient(tx), {
      incidentId: 'inc-reopen',
      command: 'REOPEN',
      source: 'WEB',
      now: NOW,
    });

    expect(tx.incident.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'inc-reopen' },
        data: expect.objectContaining({
          status: 'OPEN',
          acknowledgedAt: null,
          resolvedAt: null,
          slaAckElapsedMs: null,
          slaResolveElapsedMs: null,
          currentEscalationStep: 0,
          escalationStatus: 'ESCALATING',
          escalationGeneration: { increment: 1 },
          nextEscalationAt: new Date('2026-08-27T12:05:00.000Z'),
        }),
      })
    );
    expect(mocks.enqueueLifecycleSideEffects).toHaveBeenCalledWith(
      asTransactionClient(tx),
      expect.objectContaining({
        incidentId: 'inc-reopen',
        command: 'REOPEN',
        source: 'WEB',
        previousStatus: 'RESOLVED',
        status: 'OPEN',
        transitionAt: NOW,
      })
    );
  });

  it('unacknowledges by resuming the current escalation step', async () => {
    tx.incident.findUnique.mockResolvedValue(
      snapshot({ status: 'ACKNOWLEDGED', currentEscalationStep: 2, acknowledgedAt: NOW })
    );

    await applyIncidentLifecycleCommand(asTransactionClient(tx), {
      incidentId: 'inc-unack',
      command: 'UNACKNOWLEDGE',
      source: 'WEB',
      now: NOW,
    });

    expect(tx.incident.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'OPEN',
          acknowledgedAt: null,
          slaAckElapsedMs: null,
          escalationStatus: 'ESCALATING',
          escalationGeneration: { increment: 1 },
          nextEscalationAt: new Date('2026-08-27T12:20:00.000Z'),
        }),
      })
    );
  });

  it('unsnoozes by resuming the current escalation step and clearing snooze metadata', async () => {
    tx.incident.findUnique.mockResolvedValue(
      snapshot({
        status: 'SNOOZED',
        currentEscalationStep: 1,
        snoozedUntil: new Date('2026-08-27T13:00:00.000Z'),
        snoozeReason: 'maintenance',
      })
    );

    await applyIncidentLifecycleCommand(asTransactionClient(tx), {
      incidentId: 'inc-unsnooze',
      command: 'UNSNOOZE',
      source: 'WEB',
      now: NOW,
    });

    expect(tx.incident.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'OPEN',
          escalationStatus: 'ESCALATING',
          escalationGeneration: { increment: 1 },
          nextEscalationAt: new Date('2026-08-27T12:10:00.000Z'),
          snoozedUntil: null,
          snoozeReason: null,
        }),
      })
    );
  });

  it('unsuppresses immediately and clears pause metadata', async () => {
    tx.incident.findUnique.mockResolvedValue(
      snapshot({ status: 'SUPPRESSED', currentEscalationStep: 2 })
    );

    await applyIncidentLifecycleCommand(asTransactionClient(tx), {
      incidentId: 'inc-unsuppress',
      command: 'UNSUPPRESS',
      source: 'WEB',
      now: NOW,
    });

    expect(tx.incident.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'OPEN',
          escalationStatus: 'ESCALATING',
          escalationGeneration: { increment: 1 },
          nextEscalationAt: NOW,
        }),
      })
    );
  });

  it('validates required custom fields before resolving', async () => {
    tx.incident.findUnique.mockResolvedValue(snapshot({ status: 'OPEN' }));
    tx.customField.findMany.mockResolvedValue([{ name: 'Impact' }]);

    await expect(
      applyIncidentLifecycleCommand(asTransactionClient(tx), {
        incidentId: 'inc-required',
        command: 'RESOLVE',
        source: 'WEB',
        now: NOW,
      })
    ).rejects.toMatchObject({ code: 'INCIDENT_REQUIRED_FIELDS_MISSING', status: 422 });

    expect(tx.incident.update).not.toHaveBeenCalled();
    expect(mocks.enqueueLifecycleSideEffects).not.toHaveBeenCalled();
  });

  it('persists resolution state, resolution note, timeline, and outbox work in one transaction callback', async () => {
    tx.incident.findUnique.mockResolvedValue(snapshot({ status: 'OPEN' }));

    const result = await executeIncidentLifecycleCommand({
      incidentId: 'inc-note',
      command: 'RESOLVE',
      source: 'WEB',
      actor: { id: 'user-1', name: 'Responder' },
      resolutionNote: 'Database failover completed successfully.',
      now: NOW,
    });

    expect(mocks.runSerializableTransaction).toHaveBeenCalledOnce();
    expect(result.changed).toBe(true);
    expect(tx.incident.update).toHaveBeenCalledOnce();
    expect(tx.incidentNote.create).toHaveBeenCalledWith({
      data: {
        incidentId: 'inc-note',
        userId: 'user-1',
        content: 'Resolution: Database failover completed successfully.',
      },
    });
    expect(tx.incidentEvent.create).toHaveBeenCalledWith({
      data: {
        incidentId: 'inc-note',
        type: 'COMMENT',
        message: 'Resolution note added by Responder',
      },
    });
    expect(mocks.enqueueLifecycleSideEffects).toHaveBeenCalledWith(
      asTransactionClient(tx),
      expect.objectContaining({
        incidentId: 'inc-note',
        command: 'RESOLVE',
        source: 'WEB',
        previousStatus: 'OPEN',
        status: 'RESOLVED',
        transitionAt: NOW,
      })
    );
  });

  it('does not treat changed snooze metadata as idempotent', async () => {
    tx.incident.findUnique.mockResolvedValue(
      snapshot({
        status: 'SNOOZED',
        snoozedUntil: new Date('2026-08-27T13:00:00.000Z'),
        snoozeReason: 'old reason',
      })
    );

    const result = await applyIncidentLifecycleCommand(asTransactionClient(tx), {
      incidentId: 'inc-snooze',
      command: 'SNOOZE',
      source: 'WEB',
      snoozedUntil: new Date('2026-08-27T14:00:00.000Z'),
      snoozeReason: 'extended maintenance',
      now: NOW,
    });

    expect(result.changed).toBe(true);
    expect(tx.incident.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          snoozedUntil: new Date('2026-08-27T14:00:00.000Z'),
          snoozeReason: 'extended maintenance',
        }),
      })
    );
    expect(mocks.enqueueLifecycleSideEffects).toHaveBeenCalledWith(
      asTransactionClient(tx),
      expect.objectContaining({
        incidentId: 'inc-snooze',
        command: 'SNOOZE',
        snoozedUntil: new Date('2026-08-27T14:00:00.000Z'),
      })
    );
  });

  it('rolls back the logical batch when one transition is invalid', async () => {
    const committed: string[] = [];

    mocks.runSerializableTransaction.mockImplementation(
      async (callback: (client: ReturnType<typeof asTransactionClient>) => Promise<unknown>) => {
        const staged: string[] = [];
        const batchTx = createTx();
        batchTx.incident.findUnique.mockImplementation(({ where }: { where: { id: string } }) => {
          if (where.id === 'inc-valid') return Promise.resolve(snapshot({ status: 'OPEN' }));
          return Promise.resolve(snapshot({ status: 'RESOLVED', resolvedAt: NOW }));
        });
        batchTx.incident.update.mockImplementation(({ where }: { where: { id: string } }) => {
          staged.push(where.id);
          return Promise.resolve({});
        });

        try {
          const result = await callback(asTransactionClient(batchTx));
          committed.push(...staged);
          return result;
        } catch (error) {
          throw error;
        }
      }
    );

    await expect(
      executeIncidentLifecycleBatch([
        {
          incidentId: 'inc-valid',
          command: 'ACKNOWLEDGE',
          source: 'BULK',
          now: NOW,
        },
        {
          incidentId: 'inc-invalid',
          command: 'ACKNOWLEDGE',
          source: 'BULK',
          now: NOW,
        },
      ])
    ).rejects.toMatchObject({ code: 'INCIDENT_INVALID_TRANSITION' });

    expect(committed).toEqual([]);
  });
});
