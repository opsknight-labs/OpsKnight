import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runSerializableTransaction: vi.fn(),
  applyIncidentLifecycleTargetStatus: vi.fn(),
}));

vi.mock('@/lib/db-utils', () => ({
  runSerializableTransaction: mocks.runSerializableTransaction,
}));

vi.mock('@/lib/incidents/lifecycle', () => ({
  applyIncidentLifecycleTargetStatus: mocks.applyIncidentLifecycleTargetStatus,
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
      data: { urgency: 'HIGH', assigneeId: 'user-2' },
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
      lifecycle: { changed: true, status: 'ACKNOWLEDGED' },
    });
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
