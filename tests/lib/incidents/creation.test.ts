import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  enqueueIncidentCreationSideEffects: vi.fn(),
  applyIncidentLifecycleCommand: vi.fn(),
  runSerializableTransaction: vi.fn(),
}));

vi.mock('@/lib/event-outbox', () => ({
  enqueueIncidentCreationSideEffects: mocks.enqueueIncidentCreationSideEffects,
}));
vi.mock('@/lib/incidents/lifecycle', () => ({
  applyIncidentLifecycleCommand: mocks.applyIncidentLifecycleCommand,
}));
vi.mock('@/lib/db-utils', () => ({
  runSerializableTransaction: mocks.runSerializableTransaction,
}));

import { applyIncidentCreation, executeIncidentCreation } from '@/lib/incidents/creation';

type Tx = {
  service: { findUnique: ReturnType<typeof vi.fn> };
  customField: { findMany: ReturnType<typeof vi.fn> };
  incident: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  user: { findUnique: ReturnType<typeof vi.fn> };
  team: { findUnique: ReturnType<typeof vi.fn> };
  incidentNote: { create: ReturnType<typeof vi.fn> };
  incidentEvent: { create: ReturnType<typeof vi.fn> };
};

const NOW = new Date('2026-08-28T09:00:00.000Z');

function createTx(): Tx {
  return {
    service: { findUnique: vi.fn().mockResolvedValue({ id: 'svc-1' }) },
    customField: { findMany: vi.fn().mockResolvedValue([]) },
    incident: {
      findFirst: vi.fn(),
      create: vi.fn().mockResolvedValue({ id: 'inc-new' }),
    },
    user: { findUnique: vi.fn() },
    team: { findUnique: vi.fn() },
    incidentNote: { create: vi.fn().mockResolvedValue({}) },
    incidentEvent: { create: vi.fn().mockResolvedValue({}) },
  };
}

function asTransactionClient(tx: Tx) {
  return tx as unknown as Parameters<typeof applyIncidentCreation>[0];
}

function baseInput() {
  return {
    title: 'Database latency',
    description: 'Write latency above threshold',
    serviceId: 'svc-1',
    urgency: 'HIGH' as const,
    source: 'WEB' as const,
    actor: { id: 'user-1', name: 'Responder' },
    now: NOW,
  };
}

describe('incident creation domain engine', () => {
  let tx: Tx;

  beforeEach(() => {
    vi.clearAllMocks();
    tx = createTx();
    mocks.enqueueIncidentCreationSideEffects.mockResolvedValue(undefined);
    mocks.applyIncidentLifecycleCommand.mockResolvedValue({
      incidentId: 'inc-resolved',
      command: 'REOPEN',
      source: 'WEB',
      previousStatus: 'RESOLVED',
      status: 'OPEN',
      changed: true,
    });
    mocks.runSerializableTransaction.mockImplementation(
      async (callback: (client: ReturnType<typeof asTransactionClient>) => Promise<unknown>) =>
        callback(asTransactionClient(tx))
    );
  });

  it('commits a new incident and its creation outbox work through one transaction', async () => {
    const result = await executeIncidentCreation(baseInput());

    expect(mocks.runSerializableTransaction).toHaveBeenCalledOnce();
    expect(tx.incident.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'Database latency',
          serviceId: 'svc-1',
          status: 'OPEN',
          urgency: 'HIGH',
        }),
        select: { id: true },
      })
    );
    expect(mocks.enqueueIncidentCreationSideEffects).toHaveBeenCalledWith(
      asTransactionClient(tx),
      { incidentId: 'inc-new', source: 'WEB' }
    );
    expect(result).toEqual({ id: 'inc-new', outcome: 'CREATED' });
  });

  it('merges an active dedup match without creating or replaying creation effects', async () => {
    tx.incident.findFirst.mockResolvedValueOnce({ id: 'inc-open', status: 'OPEN' });

    const result = await applyIncidentCreation(asTransactionClient(tx), {
      ...baseInput(),
      dedupKey: 'db-latency',
    });

    expect(tx.incidentNote.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          incidentId: 'inc-open',
          content: expect.stringContaining('[Manual Report Merged]'),
        }),
      })
    );
    expect(tx.incidentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ incidentId: 'inc-open', type: 'COMMENT' }),
      })
    );
    expect(tx.incident.create).not.toHaveBeenCalled();
    expect(mocks.applyIncidentLifecycleCommand).not.toHaveBeenCalled();
    expect(mocks.enqueueIncidentCreationSideEffects).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 'inc-open', outcome: 'MERGED' });
  });

  it('reopens a recent resolved dedup match through lifecycle and lets lifecycle own effects', async () => {
    tx.incident.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'inc-resolved',
        status: 'RESOLVED',
        resolvedAt: new Date(NOW.getTime() - 10 * 60_000),
      });

    const result = await applyIncidentCreation(asTransactionClient(tx), {
      ...baseInput(),
      dedupKey: 'db-latency',
    });

    expect(mocks.applyIncidentLifecycleCommand).toHaveBeenCalledWith(
      asTransactionClient(tx),
      expect.objectContaining({
        incidentId: 'inc-resolved',
        command: 'REOPEN',
        source: 'WEB',
        expectedStatus: 'RESOLVED',
        now: NOW,
      })
    );
    const lifecycleInput = mocks.applyIncidentLifecycleCommand.mock.calls[0]?.[1];
    expect(lifecycleInput).not.toHaveProperty('sideEffectPolicy');
    expect(tx.incidentNote.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          incidentId: 'inc-resolved',
          content: expect.stringContaining('[Re-opened]'),
        }),
      })
    );
    expect(tx.incident.create).not.toHaveBeenCalled();
    expect(mocks.enqueueIncidentCreationSideEffects).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 'inc-resolved', outcome: 'REOPENED' });
  });

  it('preserves the existing REST contract when custom fields are not part of the request', async () => {
    const result = await applyIncidentCreation(asTransactionClient(tx), {
      ...baseInput(),
      source: 'REST_API',
    });

    expect(tx.customField.findMany).not.toHaveBeenCalled();
    expect(mocks.enqueueIncidentCreationSideEffects).toHaveBeenCalledWith(
      asTransactionClient(tx),
      { incidentId: 'inc-new', source: 'REST_API' }
    );
    expect(result.outcome).toBe('CREATED');
  });

  it('validates required custom fields for interactive creation before inserting the incident', async () => {
    tx.customField.findMany.mockResolvedValue([
      {
        id: 'impact',
        name: 'Impact',
        type: 'TEXT',
        required: true,
        options: null,
        defaultValue: null,
      },
    ]);

    await expect(
      applyIncidentCreation(asTransactionClient(tx), baseInput())
    ).rejects.toMatchObject({
      code: 'INCIDENT_INVALID_ARGUMENT',
      fields: [expect.objectContaining({ field: 'customField_impact' })],
    });

    expect(tx.incident.create).not.toHaveBeenCalled();
    expect(mocks.enqueueIncidentCreationSideEffects).not.toHaveBeenCalled();
  });

  it('validates assignment references only when a new incident will actually be created', async () => {
    tx.user.findUnique.mockResolvedValue({ name: 'On Call', status: 'ACTIVE' });

    await applyIncidentCreation(asTransactionClient(tx), {
      ...baseInput(),
      assigneeId: 'user-2',
    });

    expect(tx.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-2' },
      select: { name: true, status: true },
    });
    expect(tx.incident.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ assigneeId: 'user-2', teamId: null }),
      })
    );
  });
});
