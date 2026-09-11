import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const tx = {
    externalIssueLink: {
      findFirst: vi.fn(),
      upsert: vi.fn(),
    },
    externalOperation: {
      updateMany: vi.fn(),
    },
  };

  return {
    externalOperationUpdateMany: vi.fn(),
    externalOperationFindUnique: vi.fn(),
    transaction: vi.fn(),
    findJiraIssueByCorrelationLabel: vi.fn(),
    createJiraIssue: vi.fn(),
    addJiraComment: vi.fn(),
    hasJiraCommentMarker: vi.fn(),
    acquireJiraWorkspaceProviderFence: vi.fn(),
    acquireJiraActionItemLinkFence: vi.fn(),
    assertProviderAdmitted: vi.fn(),
    recordProviderFailure: vi.fn(),
    recordProviderSuccess: vi.fn(),
    tx,
  };
});

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    externalOperation: {
      updateMany: mocks.externalOperationUpdateMany,
      findUnique: mocks.externalOperationFindUnique,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock('@/lib/jira', () => ({
  findJiraIssueByCorrelationLabel: mocks.findJiraIssueByCorrelationLabel,
  createJiraIssue: mocks.createJiraIssue,
  addJiraComment: mocks.addJiraComment,
  hasJiraCommentMarker: mocks.hasJiraCommentMarker,
}));

vi.mock('@/lib/jira-concurrency', () => ({
  JIRA_PROVIDER_FENCE_MAX_WAIT_MS: 5_000,
  JIRA_PROVIDER_FENCE_TIMEOUT_MS: 40_000,
  acquireJiraWorkspaceProviderFence: mocks.acquireJiraWorkspaceProviderFence,
  acquireJiraActionItemLinkFence: mocks.acquireJiraActionItemLinkFence,
}));

vi.mock('@/lib/provider-admission', () => ({
  assertProviderAdmitted: mocks.assertProviderAdmitted,
  recordProviderFailure: mocks.recordProviderFailure,
  recordProviderSuccess: mocks.recordProviderSuccess,
}));

import { processExternalOperation } from '@/lib/external-operations';

function actionItemCreateOperation() {
  return {
    id: 'op-1',
    provider: 'JIRA',
    operation: 'CREATE_ISSUE',
    status: 'PROCESSING',
    attempts: 1,
    requestPayload: {
      actionItemId: 'action-1',
      projectKey: 'OPS',
      issueType: 'Task',
      summary: 'Follow up',
    },
  };
}

describe('durable Jira provider concurrency contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.externalOperationUpdateMany.mockResolvedValue({ count: 1 });
    mocks.externalOperationFindUnique.mockResolvedValue(actionItemCreateOperation());
    mocks.acquireJiraWorkspaceProviderFence.mockResolvedValue(undefined);
    mocks.acquireJiraActionItemLinkFence.mockResolvedValue(undefined);
    mocks.tx.externalOperation.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.externalIssueLink.upsert.mockResolvedValue({ id: 'link-1' });
    mocks.transaction.mockImplementation(async callback => callback(mocks.tx));
  });

  it('does not contact Jira when another own ticket won after the worker was queued', async () => {
    mocks.tx.externalIssueLink.findFirst.mockResolvedValue({ externalKey: 'OPS-WINNER' });

    await expect(processExternalOperation('op-1')).rejects.toThrow(
      'already linked to Jira issue OPS-WINNER'
    );

    expect(mocks.acquireJiraWorkspaceProviderFence).toHaveBeenCalledWith(mocks.tx);
    expect(mocks.acquireJiraActionItemLinkFence).toHaveBeenCalledWith(mocks.tx, 'action-1');
    expect(mocks.findJiraIssueByCorrelationLabel).not.toHaveBeenCalled();
    expect(mocks.createJiraIssue).not.toHaveBeenCalled();
    expect(mocks.tx.externalIssueLink.upsert).not.toHaveBeenCalled();
    expect(mocks.tx.externalOperation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'op-1', status: 'PROCESSING' }),
        data: expect.objectContaining({ status: 'FAILED' }),
      })
    );
  });

  it('takes both fences before Jira reconciliation/create and commits one durable link', async () => {
    const callOrder: string[] = [];
    mocks.acquireJiraWorkspaceProviderFence.mockImplementation(async () => {
      callOrder.push('workspace-fence');
    });
    mocks.acquireJiraActionItemLinkFence.mockImplementation(async () => {
      callOrder.push('action-item-fence');
    });
    mocks.tx.externalIssueLink.findFirst.mockImplementation(async () => {
      callOrder.push('ownership-check');
      return null;
    });
    mocks.findJiraIssueByCorrelationLabel.mockImplementation(async () => {
      callOrder.push('reconcile-provider');
      return null;
    });
    mocks.createJiraIssue.mockImplementation(async () => {
      callOrder.push('create-provider');
      return {
        id: 'jira-1',
        key: 'OPS-101',
        url: 'https://acme.atlassian.net/browse/OPS-101',
        status: 'To Do',
      };
    });
    mocks.tx.externalIssueLink.upsert.mockImplementation(async () => {
      callOrder.push('persist-link');
      return { id: 'link-1' };
    });

    const result = await processExternalOperation('op-1');

    expect(result?.key).toBe('OPS-101');
    expect(callOrder).toEqual([
      'workspace-fence',
      'action-item-fence',
      'ownership-check',
      'reconcile-provider',
      'create-provider',
      'persist-link',
    ]);
    expect(mocks.tx.externalIssueLink.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          provider: 'JIRA',
          actionItemId: 'action-1',
          externalKey: 'OPS-101',
        }),
      })
    );
  });
});
