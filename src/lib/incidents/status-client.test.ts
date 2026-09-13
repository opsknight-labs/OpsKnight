import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  enqueueRequest: vi.fn(),
}));

vi.mock('@/lib/offline-queue', () => ({
  enqueueRequest: mocks.enqueueRequest,
}));

import { IncidentStatusMutationError, mutateIncidentStatus } from './status-client';

describe('incident status browser transport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enqueueRequest.mockResolvedValue('queue-1');
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('window', { location: { origin: 'https://opsknight.test' } });
    vi.stubGlobal('crypto', { randomUUID: () => 'stable-request-id' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('commits a confirmed response without touching the offline queue', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );

    await expect(
      mutateIncidentStatus({ incidentId: 'inc-1', status: 'ACKNOWLEDGED', expectedStatus: 'OPEN' })
    ).resolves.toEqual({ state: 'COMMITTED', duplicate: false });
    expect(mocks.enqueueRequest).not.toHaveBeenCalled();
  });

  it('queues an ambiguous transport failure with the exact original idempotency key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('connection reset')));

    await expect(
      mutateIncidentStatus({ incidentId: 'inc-1', status: 'ACKNOWLEDGED', expectedStatus: 'OPEN' })
    ).resolves.toEqual({ state: 'QUEUED', queueId: 'queue-1' });

    expect(mocks.enqueueRequest).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'INCIDENT_STATUS',
        idempotencyKey: 'incident-status:inc-1:stable-request-id',
        expectedState: 'OPEN',
      })
    );
  });

  it('does not downgrade an authoritative conflict into an offline replay', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Conflict', code: 'STATE_CONFLICT' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );

    await expect(
      mutateIncidentStatus({ incidentId: 'inc-1', status: 'RESOLVED', expectedStatus: 'OPEN' })
    ).rejects.toMatchObject<Partial<IncidentStatusMutationError>>({
      status: 409,
      code: 'STATE_CONFLICT',
    });
    expect(mocks.enqueueRequest).not.toHaveBeenCalled();
  });

  it('reports queue failure distinctly from a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    mocks.enqueueRequest.mockResolvedValue('');

    await expect(
      mutateIncidentStatus({ incidentId: 'inc-1', status: 'ACKNOWLEDGED' })
    ).rejects.toMatchObject<Partial<IncidentStatusMutationError>>({
      code: 'OFFLINE_QUEUE_UNAVAILABLE',
      retryable: true,
    });
  });
});
