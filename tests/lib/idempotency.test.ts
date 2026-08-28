import { beforeEach, describe, expect, it, vi } from 'vitest';

import { executeIdempotentOperation } from '@/lib/idempotency';

type Tx = {
  backgroundJob: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
};

function createTx(): Tx {
  return {
    backgroundJob: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
  };
}

function asTransactionClient(tx: Tx) {
  return tx as unknown as Parameters<typeof executeIdempotentOperation>[0];
}

describe('persistent idempotency journal', () => {
  let tx: Tx;

  beforeEach(() => {
    vi.clearAllMocks();
    tx = createTx();
  });

  it('stores the operation result in a completed durable record', async () => {
    const execute = vi.fn().mockResolvedValue({ id: 'inc-1', outcome: 'CREATED' });

    const result = await executeIdempotentOperation(asTransactionClient(tx), {
      scope: 'INCIDENT_CREATION',
      context: { key: 'request-1', principalId: 'api-key-1' },
      payload: { title: 'Database latency', serviceId: 'svc-1' },
      execute,
    });

    expect(result).toEqual({
      value: { id: 'inc-1', outcome: 'CREATED' },
      replayed: false,
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(tx.backgroundJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id: 'idem:INCIDENT_CREATION:api-key-1:request-1',
          type: 'SCHEDULED_TASK',
          status: 'COMPLETED',
          maxAttempts: 1,
          payload: expect.objectContaining({
            task: 'IDEMPOTENCY_RECORD',
            scope: 'INCIDENT_CREATION',
            principalId: 'api-key-1',
            requestId: 'request-1',
            fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
            result: { id: 'inc-1', outcome: 'CREATED' },
          }),
        }),
      })
    );
  });

  it('replays the original result without executing the command again', async () => {
    const firstExecute = vi
      .fn()
      .mockResolvedValue({ changed: true, at: new Date('2026-08-28T10:00:00Z') });
    await executeIdempotentOperation(asTransactionClient(tx), {
      scope: 'INCIDENT_LIFECYCLE',
      context: { key: 'request-2', principalId: 'user-1' },
      payload: { incidentId: 'inc-1', command: 'ACKNOWLEDGE' },
      execute: firstExecute,
    });

    const persistedPayload = tx.backgroundJob.create.mock.calls[0]?.[0]?.data?.payload;
    tx.backgroundJob.findUnique.mockResolvedValue({ payload: persistedPayload });
    const replayExecute = vi.fn().mockRejectedValue(new Error('must not execute'));

    const replay = await executeIdempotentOperation(asTransactionClient(tx), {
      scope: 'INCIDENT_LIFECYCLE',
      context: { key: 'request-2', principalId: 'user-1' },
      payload: { command: 'ACKNOWLEDGE', incidentId: 'inc-1' },
      execute: replayExecute,
    });

    expect(replay.replayed).toBe(true);
    expect(replay.value).toEqual({ changed: true, at: new Date('2026-08-28T10:00:00Z') });
    expect(replayExecute).not.toHaveBeenCalled();
    expect(tx.backgroundJob.create).toHaveBeenCalledTimes(1);
  });

  it('rejects reuse of the same key with a different payload', async () => {
    await executeIdempotentOperation(asTransactionClient(tx), {
      scope: 'INCIDENT_REST_PATCH',
      context: { key: 'request-3', principalId: 'api-key-1' },
      payload: { incidentId: 'inc-1', urgency: 'HIGH' },
      execute: vi.fn().mockResolvedValue({ changed: true }),
    });

    const persistedPayload = tx.backgroundJob.create.mock.calls[0]?.[0]?.data?.payload;
    tx.backgroundJob.findUnique.mockResolvedValue({ payload: persistedPayload });

    await expect(
      executeIdempotentOperation(asTransactionClient(tx), {
        scope: 'INCIDENT_REST_PATCH',
        context: { key: 'request-3', principalId: 'api-key-1' },
        payload: { incidentId: 'inc-1', urgency: 'LOW' },
        execute: vi.fn(),
      })
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_CONFLICT', status: 409 });
  });

  it('namespaces identical request keys by principal', async () => {
    await executeIdempotentOperation(asTransactionClient(tx), {
      scope: 'INCIDENT_CREATION',
      context: { key: 'same-key', principalId: 'api-key-1' },
      payload: { title: 'One' },
      execute: vi.fn().mockResolvedValue({ id: 'inc-1' }),
    });
    const firstId = tx.backgroundJob.create.mock.calls[0]?.[0]?.data?.id;

    tx.backgroundJob.findUnique.mockResolvedValue(null);
    await executeIdempotentOperation(asTransactionClient(tx), {
      scope: 'INCIDENT_CREATION',
      context: { key: 'same-key', principalId: 'api-key-2' },
      payload: { title: 'One' },
      execute: vi.fn().mockResolvedValue({ id: 'inc-2' }),
    });
    const secondId = tx.backgroundJob.create.mock.calls[1]?.[0]?.data?.id;

    expect(firstId).not.toBe(secondId);
  });

  it('rejects oversized keys before executing the operation', async () => {
    const execute = vi.fn();
    await expect(
      executeIdempotentOperation(asTransactionClient(tx), {
        scope: 'INCIDENT_CREATION',
        context: { key: 'x'.repeat(201), principalId: 'api-key-1' },
        payload: {},
        execute,
      })
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_INVALID', status: 400 });
    expect(execute).not.toHaveBeenCalled();
  });
});
