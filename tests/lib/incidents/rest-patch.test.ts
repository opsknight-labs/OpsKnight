import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runSerializableTransaction: vi.fn(),
  applyIncidentLifecycleTargetStatus: vi.fn(),
  executeIdempotentOperation: vi.fn(),
  enqueueIncidentUpdateSideEffects: vi.fn(),
}));

vi.mock('@/lib/db-utils', () => ({
  runSerializableTransaction: mocks.runSerializableTransaction,
}));

vi.mock('@/lib/incidents/lifecycle', () => ({
  applyIncidentLifecycleTargetStatus: mocks.applyIncidentLifecycleTargetStatus,
}));

vi.mock('@/lib/idempotency', () => ({
  executeIdempotentOperation: mocks.executeIdempotentOperation,
}));

vi.mock('@/lib/event-outbox', () => ({
  enqueueIncidentUpdateSideEffects: mocks.enqueueIncidentUpdateSideEffects,
}));

import { applyRestIncidentPatch } from '@/lib/incidents/rest-patch';

type Tx = {
  incident: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  incidentEvent: {
    create: ReturnType<typeof vi.fn>;
  };
  user: {
    findUnique: ReturnType<typeof vi.fn>;
  };
};

function createTx(): Tx {
  return {
    incident: {
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    incidentEvent: {
      create: vi.fn().mockResolvedValue({}),
    },
    user: {
      findUnique: vi.fn(),
    },
  };
}

describe('REST incident patch transaction', () => {
  let tx: Tx;

  beforeEach(() => {
    vi.clearAllMocks();
    tx = createTx();
    mocks.runSerializableTransaction.mockImplementation(
      async (callback: (client: Tx) => Promise<unknown>) => callback(tx)
    );
    mocks.executeIdempotentOperation.mockImplementation(
      async (_client: Tx, input: { execute: () => Promise<unknown> }) => ({
        value: await input.execute(),
        replayed: false,
      })
    );
  });

  it('keeps lifecycle and non-lifecycle fields in one serializable transaction', async () => {
    tx.incident.findUnique
      .mockResolvedValueOnce({
        id: 'inc-1',
        status: 'OPEN',
        urgency: 'LOW',
        assigneeId: null,
      })
      .mockResolvedValueOnce({
        id: 'inc-1',
        status: 'ACKNOWLEDGED',
        urgency: 'HIGH',
        assigneeId: 'user-2',
      });
    tx.user.findUnique.mockResolvedValue({ name: 'Responder Two' });
    mocks.applyIncidentLifecycleTargetStatus.mockResolvedValue({
      incidentId: 'inc-1',
      command: 'ACKNOWLEDGE',
      source: 'REST_API',
      previousStatus: 'OPEN',
      status: 'ACKNOWLEDGED',
      changed: true,
    });

    const result = await applyRestIncidentPatch({
      incidentId: 'inc-1',
      status: 'ACKNOWLEDGED',
      urgency: 'HIGH',
      assigneeId: 'user-2',
      hasAssigneeUpdate: true,
      actor: { id: 'api-user' },
    });

    expect(mocks.runSerializableTransaction).toHaveBeenCalledOnce();
    expect(mocks.executeIdempotentOperation).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ scope: 'INCIDENT_REST_PATCH', context: undefined })
    );
    expect(mocks.applyIncidentLifecycleTargetStatus).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        incidentId: 'inc-1',
        status: 'ACKNOWLEDGED',
        source: 'REST_API',
        actor: { id: 'api-user' },
      })
    );
    expect(tx.incident.update).toHaveBeenCalledWith({
      where: { id: 'inc-1' },
      data: { urgency: 'HIGH', assigneeId: 'user-2', teamId: null },
    });
    expect(tx.incidentEvent.create).toHaveBeenCalledWith({
      data: { incidentId: 'inc-1', message: 'Urgency updated to HIGH' },
    });
    expect(tx.incidentEvent.create).toHaveBeenCalledWith({
      data: { incidentId: 'inc-1', message: 'Incident manually reassigned to Responder Two' },
    });
    expect(result).toMatchObject({
      changed: true,
      urgencyChanged: true,
      assigneeChanged: true,
      idempotencyReplayed: false,
      lifecycle: { changed: true, status: 'ACKNOWLEDGED' },
    });
  });

  it('passes the entire mixed mutation through one persistent idempotency key', async () => {
    tx.incident.findUnique
      .mockResolvedValueOnce({ id: 'inc-key', status: 'OPEN', urgency: 'LOW', assigneeId: null })
      .mockResolvedValueOnce({
        id: 'inc-key',
        status: 'ACKNOWLEDGED',
        urgency: 'HIGH',
        assigneeId: null,
      });
    mocks.applyIncidentLifecycleTargetStatus.mockResolvedValue({
      incidentId: 'inc-key',
      command: 'ACKNOWLEDGE',
      source: 'REST_API',
      previousStatus: 'OPEN',
      status: 'ACKNOWLEDGED',
      changed: true,
    });

    await applyRestIncidentPatch({
      incidentId: 'inc-key',
      status: 'ACKNOWLEDGED',
      urgency: 'HIGH',
      hasAssigneeUpdate: false,
      actor: { id: 'api-user' },
      idempotency: { key: 'patch-42', principalId: 'api-key-1' },
    });

    expect(mocks.executeIdempotentOperation).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        scope: 'INCIDENT_REST_PATCH',
        context: { key: 'patch-42', principalId: 'api-key-1' },
        payload: expect.objectContaining({
          incidentId: 'inc-key',
          status: 'ACKNOWLEDGED',
          urgency: 'HIGH',
          hasAssigneeUpdate: false,
        }),
      })
    );
  });

  it('returns a persisted replay without executing mutation code again', async () => {
    const replayValue = {
      incident: { id: 'inc-replay', status: 'ACKNOWLEDGED', urgency: 'HIGH' },
      lifecycle: { changed: true, status: 'ACKNOWLEDGED' },
      urgencyChanged: true,
      assigneeChanged: false,
      changed: true,
    };
    mocks.executeIdempotentOperation.mockResolvedValue({ value: replayValue, replayed: true });

    const result = await applyRestIncidentPatch({
      incidentId: 'inc-replay',
      status: 'ACKNOWLEDGED',
      urgency: 'HIGH',
      hasAssigneeUpdate: false,
      actor: { id: 'api-user' },
      idempotency: { key: 'patch-replay', principalId: 'api-key-1' },
    });

    expect(result).toEqual({ ...replayValue, idempotencyReplayed: true });
    expect(tx.incident.findUnique).not.toHaveBeenCalled();
    expect(tx.incident.update).not.toHaveBeenCalled();
    expect(mocks.applyIncidentLifecycleTargetStatus).not.toHaveBeenCalled();
  });

  it('persists metadata side effects in the same transaction', async () => {
    tx.incident.findUnique
      .mockResolvedValueOnce({ id: 'inc-update', status: 'OPEN', urgency: 'LOW', assigneeId: null })
      .mockResolvedValueOnce({
        id: 'inc-update',
        status: 'OPEN',
        urgency: 'HIGH',
        assigneeId: null,
      });

    await applyRestIncidentPatch({
      incidentId: 'inc-update',
      urgency: 'HIGH',
      hasAssigneeUpdate: false,
      actor: { id: 'api-user' },
    });

    expect(mocks.enqueueIncidentUpdateSideEffects).toHaveBeenCalledWith(tx, 'inc-update', [
      'INCIDENT_UPDATE_SERVICE_NOTIFICATION',
      'INCIDENT_UPDATE_WEBHOOK',
    ]);
  });

  it('preserves lifecycle no-op semantics without writing duplicate metadata or events', async () => {
    const current = {
      id: 'inc-2',
      status: 'ACKNOWLEDGED',
      urgency: 'HIGH',
      assigneeId: 'user-2',
    };
    tx.incident.findUnique.mockResolvedValue(current);
    mocks.applyIncidentLifecycleTargetStatus.mockResolvedValue({
      incidentId: 'inc-2',
      command: null,
      source: 'REST_API',
      previousStatus: 'ACKNOWLEDGED',
      status: 'ACKNOWLEDGED',
      changed: false,
    });

    const result = await applyRestIncidentPatch({
      incidentId: 'inc-2',
      status: 'ACKNOWLEDGED',
      urgency: 'HIGH',
      assigneeId: 'user-2',
      hasAssigneeUpdate: true,
      actor: { id: 'api-user' },
    });

    expect(result.changed).toBe(false);
    expect(tx.incident.update).not.toHaveBeenCalled();
    expect(tx.incidentEvent.create).not.toHaveBeenCalled();
    expect(tx.user.findUnique).not.toHaveBeenCalled();
  });

  it('fails the atomic patch when a requested assignee does not exist', async () => {
    tx.incident.findUnique.mockResolvedValueOnce({
      id: 'inc-3',
      status: 'OPEN',
      urgency: 'LOW',
      assigneeId: null,
    });
    tx.user.findUnique.mockResolvedValue(null);
    mocks.applyIncidentLifecycleTargetStatus.mockResolvedValue({
      incidentId: 'inc-3',
      command: 'ACKNOWLEDGE',
      source: 'REST_API',
      previousStatus: 'OPEN',
      status: 'ACKNOWLEDGED',
      changed: true,
    });

    await expect(
      applyRestIncidentPatch({
        incidentId: 'inc-3',
        status: 'ACKNOWLEDGED',
        assigneeId: 'missing-user',
        hasAssigneeUpdate: true,
        actor: { id: 'api-user' },
      })
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 });

    expect(tx.incident.update).not.toHaveBeenCalled();
    expect(tx.incidentEvent.create).not.toHaveBeenCalled();
  });

  it('propagates typed lifecycle validation failures unchanged', async () => {
    tx.incident.findUnique.mockResolvedValueOnce({
      id: 'inc-4',
      status: 'OPEN',
      urgency: 'LOW',
      assigneeId: null,
    });
    mocks.applyIncidentLifecycleTargetStatus.mockRejectedValue(
      Object.assign(new Error('Complete required custom fields'), {
        code: 'INCIDENT_REQUIRED_FIELDS_MISSING',
        status: 422,
      })
    );

    await expect(
      applyRestIncidentPatch({
        incidentId: 'inc-4',
        status: 'RESOLVED',
        hasAssigneeUpdate: false,
        actor: { id: 'api-user' },
      })
    ).rejects.toMatchObject({ code: 'INCIDENT_REQUIRED_FIELDS_MISSING', status: 422 });
  });
});
