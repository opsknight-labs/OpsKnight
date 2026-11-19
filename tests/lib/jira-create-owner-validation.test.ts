import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    $transaction: mocks.transaction,
    externalOperation: { updateMany: vi.fn(), findUnique: vi.fn() },
  },
}));
vi.mock('@/lib/jira', () => ({
  createJiraIssue: vi.fn(),
  findJiraIssueByCorrelationLabel: vi.fn(),
  addJiraComment: vi.fn(),
  hasJiraCommentMarker: vi.fn(),
}));
vi.mock('@/lib/jira-concurrency', () => ({
  JIRA_PROVIDER_FENCE_MAX_WAIT_MS: 5_000,
  JIRA_PROVIDER_FENCE_TIMEOUT_MS: 40_000,
  acquireJiraWorkspaceProviderFence: vi.fn(),
  acquireJiraActionItemLinkFence: vi.fn(),
  acquireJiraExternalIssueLinkFence: vi.fn(),
}));
vi.mock('@/lib/provider-admission', () => ({
  ProviderCooldownError: class ProviderCooldownError extends Error {},
  assertProviderAdmitted: vi.fn(),
  recordProviderFailure: vi.fn(),
  recordProviderSuccess: vi.fn(),
}));

import { enqueueJiraCreateOperation } from '@/lib/external-operations';

describe('Jira create ownership invariant', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects missing and dual owners before writing a durable operation', async () => {
    await expect(
      enqueueJiraCreateOperation({ projectKey: 'OPS', issueType: 'Task', summary: 'No owner' })
    ).rejects.toThrow('exactly one OpsKnight entity');

    await expect(
      enqueueJiraCreateOperation({
        incidentId: 'inc-1',
        actionItemId: 'action-1',
        projectKey: 'OPS',
        issueType: 'Task',
        summary: 'Two owners',
      })
    ).rejects.toThrow('exactly one OpsKnight entity');

    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  describe('re-creating after unlink or failure', () => {
    const input = { incidentId: 'inc-1', projectKey: 'OPS', issueType: 'Bug', summary: 'Outage' };
    function txWith(existing: Record<string, unknown> | null, linked: boolean) {
      const tx = {
        externalOperation: {
          findUnique: vi.fn().mockResolvedValue(existing),
          update: vi.fn(),
          create: vi.fn().mockResolvedValue({ id: 'op-new' }),
        },
        externalIssueLink: { findUnique: vi.fn().mockResolvedValue(linked ? { id: 'l' } : null) },
        backgroundJob: { create: vi.fn() },
      };
      mocks.transaction.mockImplementation((fn: (client: typeof tx) => unknown) => fn(tx));
      return tx;
    }

    it('starts a new operation when the previously created issue was unlinked', async () => {
      const tx = txWith({ id: 'op-old', status: 'COMPLETED', externalId: '10001' }, false);
      await expect(enqueueJiraCreateOperation(input)).resolves.toBe('op-new');
      expect(tx.externalOperation.update).toHaveBeenCalledWith({
        where: { id: 'op-old' },
        data: { idempotencyKey: 'jira:create:incident:inc-1:retired:op-old' },
      });
      const job = tx.backgroundJob.create.mock.calls[0][0].data;
      expect(job.scheduledAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('keeps returning the operation while its issue is still linked', async () => {
      const tx = txWith({ id: 'op-old', status: 'COMPLETED', externalId: '10001' }, true);
      await expect(enqueueJiraCreateOperation(input)).resolves.toBe('op-old');
      expect(tx.externalOperation.update).not.toHaveBeenCalled();
      expect(tx.externalOperation.create).not.toHaveBeenCalled();
    });

    it('applies the corrected request to a failed operation instead of replaying the old one', async () => {
      const tx = txWith({ id: 'op-old', status: 'FAILED', externalId: null }, false);
      await expect(enqueueJiraCreateOperation({ ...input, issueType: 'Task' })).resolves.toBe(
        'op-old'
      );
      expect(tx.externalOperation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'op-old' },
          data: expect.objectContaining({
            requestPayload: expect.objectContaining({ issueType: 'Task' }),
            attempts: 0,
          }),
        })
      );
    });
  });
});
