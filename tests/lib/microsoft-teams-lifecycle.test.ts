import { describe, expect, it, vi } from 'vitest';
import { revokeMicrosoftTeamsOperations, revokeMicrosoftTeamsWarRoomProvisioning } from '@/lib/microsoft-teams/lifecycle';

type OperationWhere = { OR?: Array<{ requestPayload: { path: string[]; equals: string } }> };

// The destination filter now runs in the database; the mock applies the same JSON-path filter.
function transactionWith(operations: Array<Record<string, unknown>>) {
  const matching = (where: OperationWhere) =>
    operations.filter(
      operation =>
        !where.OR ||
        where.OR.some(
          clause =>
            (operation.requestPayload as Record<string, unknown>)?.destinationId ===
            clause.requestPayload.equals
        )
    );
  return {
    externalOperation: {
      findMany: vi.fn(async ({ where }: { where: OperationWhere }) => matching(where)),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    microsoftTeamsIncidentMessage: {
      updateMany: vi.fn(async () => ({ count: 1 })),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
    backgroundJob: {
      findMany: vi.fn(async () => operations.map((operation, index) => ({
        id: `job-${index}`,
        payload: { operationId: operation.id },
      }))),
      updateMany: vi.fn(async () => ({ count: operations.length })),
    },
  };
}

describe('Microsoft Teams lifecycle revocation', () => {
  it('preserves ambiguous truth and promotes only a post-I/O in-flight create', async () => {
    const tx = transactionWith([
      { id: 'ambiguous', status: 'AMBIGUOUS', requestPayload: { destinationId: 'dest-1' }, resultPayload: { createAttempted: true } },
      { id: 'post-io', status: 'PROCESSING', requestPayload: { destinationId: 'dest-1' }, resultPayload: { createAttempted: true } },
      { id: 'pre-io', status: 'PROCESSING', requestPayload: { destinationId: 'dest-1' }, resultPayload: null },
      { id: 'queued', status: 'PENDING', requestPayload: { destinationId: 'dest-1' }, resultPayload: null },
    ]);

    const result = await revokeMicrosoftTeamsOperations(tx as never, {
      destinationIds: ['dest-1'],
      reason: 'Teams route revoked',
    });

    expect(result).toEqual({ operationIds: ['ambiguous', 'post-io', 'pre-io', 'queued'], jobsCancelled: 4 });
    expect(tx.externalOperation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['ambiguous', 'post-io'] } }, data: expect.objectContaining({ status: 'AMBIGUOUS' }) }));
    expect(tx.externalOperation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['pre-io', 'queued'] } }, data: expect.objectContaining({ status: 'FAILED' }) }));
    expect(tx.microsoftTeamsIncidentMessage.deleteMany).toHaveBeenCalledWith({
      where: { messageId: { in: ['__reserved__:pre-io', '__reserved__:queued'] } },
    });
  });

  it('does not revoke operations belonging to another destination', async () => {
    const tx = transactionWith([
      { id: 'kept', status: 'AMBIGUOUS', requestPayload: { destinationId: 'dest-2' }, resultPayload: { createAttempted: true } },
    ]);

    const result = await revokeMicrosoftTeamsOperations(tx as never, {
      destinationIds: ['dest-1'],
      reason: 'Teams destination unlinked',
    });

    expect(result).toEqual({ operationIds: [], jobsCancelled: 0 });
    expect(tx.externalOperation.updateMany).not.toHaveBeenCalled();
    expect(tx.backgroundJob.updateMany).not.toHaveBeenCalled();
  });

  it('fences provisioners and retains attempted room creation as ambiguous', async () => {
    const rooms = [
      { id: 'safe-room', destinationId: 'dest-1', createAttemptedAt: null },
      { id: 'unknown-room', destinationId: 'dest-1', createAttemptedAt: new Date() },
      { id: 'other-room', destinationId: 'dest-2', createAttemptedAt: null },
    ];
    const tx = {
      incidentWarRoom: {
        findMany: vi.fn(async ({ where }: { where: { state: { in: string[] }; destinationId?: { in: string[] } } }) =>
          where.state.in.includes('PROVISIONING')
            ? rooms.filter(room => !where.destinationId || where.destinationId.in.includes(room.destinationId))
            : []
        ),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      backgroundJob: {
        findMany: vi.fn(async () => [
          { id: 'safe-job', payload: { warRoomId: 'safe-room' } },
          { id: 'unknown-job', payload: { warRoomId: 'unknown-room' } },
          { id: 'other-job', payload: { warRoomId: 'other-room' } },
        ]),
        updateMany: vi.fn(async () => ({ count: 2 })),
      },
    };

    const result = await revokeMicrosoftTeamsWarRoomProvisioning(tx as never, {
      destinationIds: ['dest-1'], reason: 'Teams destination unlinked',
    });

    expect(result).toEqual({ warRoomIds: ['safe-room', 'unknown-room'], jobsCancelled: 2 });
    expect(tx.incidentWarRoom.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ destinationId: { in: ['dest-1'] } }),
    }));
    expect(tx.incidentWarRoom.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { in: ['safe-room'] } }),
      data: expect.objectContaining({ state: 'FAILED', provisioningToken: null }),
    }));
    expect(tx.incidentWarRoom.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { in: ['unknown-room'] } }),
      data: expect.objectContaining({ state: 'AMBIGUOUS', provisioningToken: null }),
    }));
    expect(tx.backgroundJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { in: ['safe-job', 'unknown-job'] } }),
      data: expect.objectContaining({ status: 'CANCELLED' }),
    }));
  });
});
