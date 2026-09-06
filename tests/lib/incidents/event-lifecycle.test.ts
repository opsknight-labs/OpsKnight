import { describe, expect, it, vi } from 'vitest';
import { applyIncidentLifecycleCommand } from '@/lib/incidents/lifecycle';

const NOW = new Date('2026-08-28T05:30:00.000Z');

function createTx() {
  return {
    $queryRaw: vi.fn().mockResolvedValue([{ now: NOW }]),
    incident: {
      findUnique: vi.fn().mockResolvedValue({
        status: 'OPEN',
        createdAt: new Date('2026-08-28T05:00:00.000Z'),
        acknowledgedAt: null,
        resolvedAt: null,
        currentEscalationStep: 0,
        snoozedUntil: null,
        snoozeReason: null,
        slaPausedMs: BigInt(0),
        slaPauseStartedAt: null,
        slaAckElapsedMs: null,
        slaResolveElapsedMs: null,
        escalationGeneration: 0,
        service: { policy: { steps: [{ delayMinutes: 5 }] } },
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    customField: {
      findMany: vi.fn().mockResolvedValue([{ name: 'Impact' }]),
    },
    incidentNote: {
      create: vi.fn().mockResolvedValue({}),
    },
    incidentEvent: {
      create: vi.fn().mockResolvedValue({}),
    },
    backgroundJob: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

function asTransactionClient(tx: ReturnType<typeof createTx>) {
  return tx as unknown as Parameters<typeof applyIncidentLifecycleCommand>[0];
}

describe('event-driven incident lifecycle semantics', () => {
  it('treats upstream resolve as automatic and does not require human custom fields', async () => {
    const tx = createTx();

    const result = await applyIncidentLifecycleCommand(asTransactionClient(tx), {
      incidentId: 'inc-event-resolve',
      command: 'RESOLVE',
      source: 'EVENT',
      eventMessage: 'Auto-resolved by event from prometheus.',
      now: NOW,
    });

    expect(result).toMatchObject({
      incidentId: 'inc-event-resolve',
      source: 'EVENT',
      status: 'RESOLVED',
      changed: true,
    });
    expect(tx.customField.findMany).not.toHaveBeenCalled();
    expect(tx.incident.update).toHaveBeenCalledWith({
      where: { id: 'inc-event-resolve' },
      data: expect.objectContaining({
        status: 'RESOLVED',
        resolvedAt: NOW,
        escalationStatus: 'COMPLETED',
        nextEscalationAt: null,
        events: {
          create: {
            type: 'AUTO_RESOLVED',
            message: 'Auto-resolved by event from prometheus.',
          },
        },
      }),
    });
  });

  it('classifies an event resolve as AUTO_RESOLVED even without a custom message', async () => {
    const tx = createTx();

    await applyIncidentLifecycleCommand(asTransactionClient(tx), {
      incidentId: 'inc-event-default-message',
      command: 'RESOLVE',
      source: 'EVENT',
      now: NOW,
    });

    expect(tx.incident.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          events: {
            create: {
              type: 'AUTO_RESOLVED',
              message: 'Incident resolved',
            },
          },
        }),
      })
    );
  });
});
