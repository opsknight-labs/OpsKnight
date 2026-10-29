import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const tx = {
    externalIssueLink: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
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
    acquireJiraExternalIssueLinkFence: vi.fn(),
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
  acquireJiraExternalIssueLinkFence: mocks.acquireJiraExternalIssueLinkFence,
}));

vi.mock('@/lib/provider-admission', () => ({
  assertProviderAdmitted: mocks.assertProviderAdmitted,
  recordProviderFailure: mocks.recordProviderFailure,
  recordProviderSuccess: mocks.recordProviderSuccess,
}));

import { processExternalOperation } from '@/lib/external-operations';

function actionItemCreateOperation(attempts = 1) {
  return {
    id: 'op-1',
    provider: 'JIRA',
    operation: 'CREATE_ISSUE',
    status: 'PROCESSING',
    attempts,
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
    mocks.acquireJiraExternalIssueLinkFence.mockResolvedValue(undefined);
    mocks.assertProviderAdmitted.mockResolvedValue(undefined);
    mocks.recordProviderFailure.mockResolvedValue(undefined);
    mocks.recordProviderSuccess.mockResolvedValue(undefined);
    mocks.tx.externalOperation.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.externalIssueLink.create.mockResolvedValue({ id: 'link-1' });
    mocks.tx.externalIssueLink.update.mockResolvedValue({ id: 'link-1' });
    mocks.transaction.mockImplementation(async callback => callback(mocks.tx));
  });

  it('does not contact Jira when another own ticket won after the worker was queued', async () => {
    mocks.tx.externalIssueLink.findFirst.mockResolvedValue({ externalKey: 'OPS-WINNER' });

    await expect(processExternalOperation('op-1')).rejects.toThrow(
      'already linked to Jira issue OPS-WINNER'
    );

    expect(mocks.assertProviderAdmitted).toHaveBeenCalledWith('jira:workspace');
    expect(mocks.acquireJiraWorkspaceProviderFence).toHaveBeenCalledWith(mocks.tx);
    expect(mocks.acquireJiraActionItemLinkFence).toHaveBeenCalledWith(mocks.tx, 'action-1');
    expect(mocks.findJiraIssueByCorrelationLabel).not.toHaveBeenCalled();
    expect(mocks.createJiraIssue).not.toHaveBeenCalled();
    expect(mocks.tx.externalIssueLink.create).not.toHaveBeenCalled();
    expect(mocks.tx.externalOperation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'op-1', status: 'PROCESSING' }),
        data: expect.objectContaining({ status: 'FAILED' }),
      })
    );
  });

  it('locks the provider issue identity and creates one immutable owner link', async () => {
    const callOrder: string[] = [];
    let ownershipChecks = 0;
    mocks.acquireJiraWorkspaceProviderFence.mockImplementation(async () => {
      callOrder.push('workspace-fence');
    });
    mocks.acquireJiraActionItemLinkFence.mockImplementation(async () => {
      callOrder.push('action-item-fence');
    });
    mocks.tx.externalIssueLink.findFirst.mockImplementation(async () => {
      ownershipChecks += 1;
      callOrder.push(ownershipChecks === 1 ? 'owner-check' : 'external-key-recheck');
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
    mocks.acquireJiraExternalIssueLinkFence.mockImplementation(async () => {
      callOrder.push('external-key-fence');
    });
    mocks.tx.externalIssueLink.create.mockImplementation(async () => {
      callOrder.push('persist-link');
      return { id: 'link-1' };
    });

    const result = await processExternalOperation('op-1');

    expect(result?.key).toBe('OPS-101');
    expect(callOrder).toEqual([
      'workspace-fence',
      'action-item-fence',
      'owner-check',
      'reconcile-provider',
      'create-provider',
      'external-key-fence',
      'external-key-recheck',
      'persist-link',
    ]);
    expect(mocks.acquireJiraExternalIssueLinkFence).toHaveBeenCalledWith(
      mocks.tx,
      'JIRA',
      'OPS-101'
    );
    expect(mocks.tx.externalIssueLink.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        provider: 'JIRA',
        actionItemId: 'action-1',
        incidentId: null,
        externalKey: 'OPS-101',
      }),
    });
    expect(mocks.tx.externalIssueLink.update).not.toHaveBeenCalled();
    expect(mocks.recordProviderSuccess).toHaveBeenCalledWith('jira:workspace');
  });

  it('fails instead of transferring a Jira issue already owned by another entity', async () => {
    mocks.tx.externalIssueLink.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'link-other',
        incidentId: 'inc-other',
        actionItemId: null,
        externalKey: 'OPS-101',
      });
    mocks.findJiraIssueByCorrelationLabel.mockResolvedValue({
      id: 'jira-1',
      key: 'OPS-101',
      url: 'https://acme.atlassian.net/browse/OPS-101',
      status: 'To Do',
    });

    await expect(processExternalOperation('op-1')).rejects.toThrow(
      'already linked to another OpsKnight entity'
    );

    expect(mocks.tx.externalIssueLink.create).not.toHaveBeenCalled();
    expect(mocks.tx.externalIssueLink.update).not.toHaveBeenCalled();
    expect(mocks.tx.externalOperation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) })
    );
  });

  it('marks the final create attempt FAILED rather than permanently AMBIGUOUS', async () => {
    mocks.externalOperationFindUnique.mockResolvedValue(actionItemCreateOperation(8));
    mocks.tx.externalIssueLink.findFirst.mockResolvedValue(null);
    mocks.findJiraIssueByCorrelationLabel.mockRejectedValue(new Error('provider unavailable'));

    await expect(processExternalOperation('op-1')).rejects.toThrow('provider unavailable');

    expect(mocks.externalOperationUpdateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'op-1', status: 'PROCESSING' }),
        data: expect.objectContaining({ status: 'FAILED' }),
      })
    );
  });
});
