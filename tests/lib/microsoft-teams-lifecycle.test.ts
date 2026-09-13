import { describe, expect, it, vi } from 'vitest';
import { revokeMicrosoftTeamsOperations } from '@/lib/microsoft-teams/lifecycle';

function transactionWith(operations: Array<Record<string, unknown>>) {
  return {
    externalOperation: {
      findMany: vi.fn(async () => operations),
      update: vi.fn(async () => undefined),
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
    expect(tx.externalOperation.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'ambiguous' }, data: expect.objectContaining({ status: 'AMBIGUOUS' }) }));
    expect(tx.externalOperation.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'post-io' }, data: expect.objectContaining({ status: 'AMBIGUOUS' }) }));
    expect(tx.externalOperation.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'pre-io' }, data: expect.objectContaining({ status: 'FAILED' }) }));
    expect(tx.externalOperation.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'queued' }, data: expect.objectContaining({ status: 'FAILED' }) }));
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
    expect(tx.externalOperation.update).not.toHaveBeenCalled();
    expect(tx.backgroundJob.updateMany).not.toHaveBeenCalled();
  });
});
