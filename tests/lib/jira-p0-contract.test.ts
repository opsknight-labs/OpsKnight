import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const tx = {
    externalIssueLink: {
      findFirst: vi.fn(),
      deleteMany: vi.fn(),
    },
  };

  return {
    assertAdminOrResponder: vi.fn(),
    actionItemFindUnique: vi.fn(),
    incidentFindUnique: vi.fn(),
    externalIssueFindFirst: vi.fn(),
    externalIssueDeleteMany: vi.fn(),
    incidentEventCreate: vi.fn(),
    createJiraIssueAndLink: vi.fn(),
    linkExistingJiraIssue: vi.fn(),
    syncExternalIssueLink: vi.fn(),
    getJiraCapabilities: vi.fn(),
    acquireJiraWorkspaceProviderFence: vi.fn(),
    acquireJiraActionItemLinkFence: vi.fn(),
    withJiraWorkspaceProviderFence: vi.fn(),
    revalidatePath: vi.fn(),
    transaction: vi.fn(),
    tx,
  };
});

vi.mock('@/lib/rbac', () => ({
  assertAdminOrResponder: mocks.assertAdminOrResponder,
}));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    actionItem: { findUnique: mocks.actionItemFindUnique },
    incident: { findUnique: mocks.incidentFindUnique },
    externalIssueLink: {
      findFirst: mocks.externalIssueFindFirst,
      deleteMany: mocks.externalIssueDeleteMany,
    },
    incidentEvent: { create: mocks.incidentEventCreate },
    $transaction: mocks.transaction,
  },
}));

vi.mock('@/lib/jira-sync', () => ({
  createJiraIssueAndLink: mocks.createJiraIssueAndLink,
  linkExistingJiraIssue: mocks.linkExistingJiraIssue,
  syncExternalIssueLink: mocks.syncExternalIssueLink,
}));

vi.mock('@/lib/jira-capabilities', async importOriginal => {
  const original = await importOriginal<typeof import('@/lib/jira-capabilities')>();
  return {
    ...original,
    getJiraCapabilities: mocks.getJiraCapabilities,
  };
});

vi.mock('@/lib/jira-concurrency', () => ({
  JIRA_PROVIDER_FENCE_MAX_WAIT_MS: 5_000,
  JIRA_PROVIDER_FENCE_TIMEOUT_MS: 40_000,
  acquireJiraWorkspaceProviderFence: mocks.acquireJiraWorkspaceProviderFence,
  acquireJiraActionItemLinkFence: mocks.acquireJiraActionItemLinkFence,
  withJiraWorkspaceProviderFence: mocks.withJiraWorkspaceProviderFence,
}));

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));

import {
  createJiraIssueFromActionItem,
  linkJiraIssueToActionItem,
  syncActionItemJiraIssue,
  unlinkJiraIssueFromActionItem,
} from '@/app/(app)/action-items/jira/actions';
import {
  syncIncidentJiraIssue,
  unlinkJiraIssueFromIncident,
} from '@/app/(app)/incidents/jira/actions';

const OPERATIONAL_CAPABILITY = {
  workspaceState: 'ENABLED' as const,
  serviceMapped: true,
  syncEnabled: true,
  showOperationalJira: true,
  canCreate: true,
  canLink: true,
  canSync: true,
  canUnlink: true,
  reason: 'OK' as const,
  rawEnabled: true,
};

describe('Jira P0 production action contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertAdminOrResponder.mockResolvedValue({ id: 'responder-1' });
    mocks.externalIssueDeleteMany.mockResolvedValue({ count: 1 });
    mocks.tx.externalIssueLink.deleteMany.mockResolvedValue({ count: 1 });
    mocks.incidentEventCreate.mockResolvedValue({ id: 'event-1' });
    mocks.getJiraCapabilities.mockResolvedValue(OPERATIONAL_CAPABILITY);
    mocks.acquireJiraWorkspaceProviderFence.mockResolvedValue(undefined);
    mocks.acquireJiraActionItemLinkFence.mockResolvedValue(undefined);
    mocks.transaction.mockImplementation(async callback => callback(mocks.tx));
    mocks.withJiraWorkspaceProviderFence.mockImplementation(async work => work());
  });

  describe('action-item ownership, policy, and concurrency', () => {
    it('rejects malformed action-item requests before authorization or provider work', async () => {
      const result = await linkJiraIssueToActionItem('../action-1', 'OPS-1');

      expect(result).toEqual({ success: false, error: 'Invalid Jira action request.' });
      expect(mocks.assertAdminOrResponder).not.toHaveBeenCalled();
      expect(mocks.linkExistingJiraIssue).not.toHaveBeenCalled();
    });

    it('rejects stale Create Jira requests when the action item is already linked', async () => {
      mocks.actionItemFindUnique.mockResolvedValue({
        id: 'action-1',
        title: 'Follow up',
        description: null,
        incidentId: 'inc-1',
        externalIssueLinks: [{ externalKey: 'OPS-123' }],
        incident: { service: { id: 'svc-1', jiraServiceMapping: { projectKey: 'OPS' } } },
      });

      const result = await createJiraIssueFromActionItem('action-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('already linked');
      expect(result.error).toContain('OPS-123');
      expect(mocks.createJiraIssueAndLink).not.toHaveBeenCalled();
      expect(mocks.getJiraCapabilities).not.toHaveBeenCalled();
    });

    it('rejects stale Link Jira requests when the action item is already linked', async () => {
      mocks.actionItemFindUnique.mockResolvedValue({
        id: 'action-1',
        incidentId: 'inc-1',
        incident: { serviceId: 'svc-1' },
        externalIssueLinks: [{ externalKey: 'OPS-123' }],
      });

      const result = await linkJiraIssueToActionItem('action-1', 'OPS-456');

      expect(result.success).toBe(false);
      expect(result.error).toContain('already linked');
      expect(mocks.linkExistingJiraIssue).not.toHaveBeenCalled();
    });

    it('rechecks ownership after acquiring the per-action-item fence', async () => {
      mocks.actionItemFindUnique.mockResolvedValue({
        id: 'action-1',
        incidentId: 'inc-1',
        incident: { serviceId: 'svc-1' },
        externalIssueLinks: [],
      });
      mocks.tx.externalIssueLink.findFirst.mockResolvedValue({ externalKey: 'OPS-WINNER' });
      mocks.externalIssueFindFirst.mockResolvedValue({ externalKey: 'OPS-WINNER' });

      const result = await linkJiraIssueToActionItem('action-1', 'OPS-LOSER');

      expect(result.success).toBe(false);
      expect(result.error).toContain('OPS-WINNER');
      expect(mocks.acquireJiraWorkspaceProviderFence).toHaveBeenCalledWith(mocks.tx);
      expect(mocks.acquireJiraActionItemLinkFence).toHaveBeenCalledWith(mocks.tx, 'action-1');
      expect(mocks.linkExistingJiraIssue).not.toHaveBeenCalled();
    });

    it('denies stale unlink requests when Jira was disabled after render', async () => {
      mocks.externalIssueFindFirst.mockResolvedValue({
        id: 'link-1',
        externalKey: 'OPS-1',
        actionItem: { incidentId: 'inc-1', incident: { serviceId: 'svc-1' } },
      });
      mocks.getJiraCapabilities.mockResolvedValue({
        ...OPERATIONAL_CAPABILITY,
        workspaceState: 'DISABLED',
        showOperationalJira: false,
        canCreate: false,
        canLink: false,
        canSync: false,
        canUnlink: false,
        reason: 'DISABLED',
        rawEnabled: false,
      });

      const result = await unlinkJiraIssueFromActionItem('action-1', 'link-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('disabled');
      expect(mocks.transaction).not.toHaveBeenCalled();
      expect(mocks.externalIssueDeleteMany).not.toHaveBeenCalled();
    });

    it('requires the exact actionItemId for unlink and scopes the locked mutation itself', async () => {
      mocks.externalIssueFindFirst.mockResolvedValue({
        id: 'link-1',
        externalKey: 'OPS-1',
        actionItem: { incidentId: 'inc-1', incident: { serviceId: 'svc-1' } },
      });
      mocks.tx.externalIssueLink.findFirst.mockResolvedValue({ id: 'link-1' });

      const result = await unlinkJiraIssueFromActionItem('action-1', 'link-1');

      expect(result).toEqual({ success: true });
      expect(mocks.externalIssueFindFirst).toHaveBeenCalledWith({
        where: { id: 'link-1', provider: 'JIRA', actionItemId: 'action-1' },
        select: {
          id: true,
          externalKey: true,
          actionItem: {
            select: {
              incidentId: true,
              incident: { select: { serviceId: true } },
            },
          },
        },
      });
      expect(mocks.tx.externalIssueLink.deleteMany).toHaveBeenCalledWith({
        where: { id: 'link-1', provider: 'JIRA', actionItemId: 'action-1' },
      });
      expect(mocks.acquireJiraActionItemLinkFence).toHaveBeenCalledWith(mocks.tx, 'action-1');
    });

    it("does not unlink another action item's Jira link", async () => {
      mocks.externalIssueFindFirst.mockResolvedValue(null);

      const result = await unlinkJiraIssueFromActionItem('action-A', 'link-owned-by-B');

      expect(result.success).toBe(false);
      expect(result.error).toContain('this action item');
      expect(mocks.transaction).not.toHaveBeenCalled();
    });

    it("does not call Jira sync for another action item's link", async () => {
      mocks.externalIssueFindFirst.mockResolvedValue(null);

      const result = await syncActionItemJiraIssue('action-A', 'link-owned-by-B');

      expect(result.success).toBe(false);
      expect(mocks.syncExternalIssueLink).not.toHaveBeenCalled();
    });

    it('propagates a null sync result as failure instead of claiming success', async () => {
      mocks.externalIssueFindFirst.mockResolvedValue({
        id: 'link-1',
        actionItem: { incidentId: 'inc-1', incident: { serviceId: 'svc-1' } },
      });
      mocks.tx.externalIssueLink.findFirst.mockResolvedValue({ id: 'link-1' });
      mocks.syncExternalIssueLink.mockResolvedValue(null);

      const result = await syncActionItemJiraIssue('action-1', 'link-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('sync failed');
      expect(mocks.syncExternalIssueLink).toHaveBeenCalledWith('link-1');
      expect(mocks.acquireJiraActionItemLinkFence).toHaveBeenCalledWith(mocks.tx, 'action-1');
    });

    it('uses the production Jira error classifier for provider failures', async () => {
      mocks.externalIssueFindFirst.mockResolvedValue({
        id: 'link-1',
        actionItem: { incidentId: 'inc-1', incident: { serviceId: 'svc-1' } },
      });
      mocks.tx.externalIssueLink.findFirst.mockResolvedValue({ id: 'link-1' });
      mocks.syncExternalIssueLink.mockRejectedValue(new Error('Jira request failed (401)'));

      const result = await syncActionItemJiraIssue('action-1', 'link-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('authentication failed');
    });
  });

  describe('incident ownership and server capability enforcement', () => {
    it('requires the exact incidentId for unlink and scopes the mutation itself', async () => {
      mocks.externalIssueFindFirst.mockResolvedValue({
        id: 'link-2',
        externalKey: 'OPS-2',
        incidentId: 'inc-2',
        incident: { serviceId: 'svc-2' },
      });
      mocks.externalIssueDeleteMany.mockResolvedValue({ count: 1 });

      const result = await unlinkJiraIssueFromIncident('link-2', 'inc-2');

      expect(result).toEqual({ success: true });
      expect(mocks.externalIssueFindFirst).toHaveBeenCalledWith({
        where: { id: 'link-2', provider: 'JIRA', incidentId: 'inc-2' },
        select: {
          id: true,
          externalKey: true,
          incidentId: true,
          incident: { select: { serviceId: true } },
        },
      });
      expect(mocks.externalIssueDeleteMany).toHaveBeenCalledWith({
        where: { id: 'link-2', provider: 'JIRA', incidentId: 'inc-2' },
      });
      expect(mocks.withJiraWorkspaceProviderFence).toHaveBeenCalled();
      expect(mocks.incidentEventCreate).toHaveBeenCalledWith({
        data: {
          incidentId: 'inc-2',
          type: 'COMMENT',
          message: 'Jira issue OPS-2 unlinked',
        },
      });
    });

    it('denies stale incident sync when service sync was disabled', async () => {
      mocks.externalIssueFindFirst.mockResolvedValue({
        id: 'link-3',
        incident: { serviceId: 'svc-3' },
      });
      mocks.getJiraCapabilities.mockResolvedValue({
        ...OPERATIONAL_CAPABILITY,
        syncEnabled: false,
        canSync: false,
        reason: 'SYNC_DISABLED',
      });

      const result = await syncIncidentJiraIssue('link-3', 'inc-3');

      expect(result.success).toBe(false);
      expect(result.error).toContain('sync is disabled');
      expect(mocks.syncExternalIssueLink).not.toHaveBeenCalled();
    });

    it("does not call Jira sync for another incident's link", async () => {
      mocks.externalIssueFindFirst.mockResolvedValue(null);

      const result = await syncIncidentJiraIssue('link-owned-by-B', 'inc-A');

      expect(result.success).toBe(false);
      expect(mocks.syncExternalIssueLink).not.toHaveBeenCalled();
    });

    it('reports successful owned sync only when the production sync returns a link', async () => {
      mocks.externalIssueFindFirst.mockResolvedValue({
        id: 'link-3',
        incident: { serviceId: 'svc-3' },
      });
      mocks.syncExternalIssueLink.mockResolvedValue({ id: 'link-3', externalKey: 'OPS-3' });

      const result = await syncIncidentJiraIssue('link-3', 'inc-3');

      expect(result).toEqual({ success: true });
      expect(mocks.syncExternalIssueLink).toHaveBeenCalledWith('link-3');
      expect(mocks.withJiraWorkspaceProviderFence).toHaveBeenCalled();
    });
  });
});
