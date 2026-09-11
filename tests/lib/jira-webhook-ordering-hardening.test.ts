import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  externalIssueFindMany: vi.fn(),
  externalIssueUpdateMany: vi.fn(),
  actionItemFindMany: vi.fn(),
  incidentEventCreate: vi.fn(),
  incidentUpdate: vi.fn(),
  getDefaultActorId: vi.fn(),
  logAudit: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    externalIssueLink: {
      findMany: mocks.externalIssueFindMany,
      updateMany: mocks.externalIssueUpdateMany,
    },
    actionItem: { findMany: mocks.actionItemFindMany },
    incidentEvent: { create: mocks.incidentEventCreate },
    incident: { update: mocks.incidentUpdate },
  },
}));

vi.mock('@/lib/jira', () => ({ getJiraIssue: vi.fn() }));
vi.mock('@/lib/external-operations', () => ({
  enqueueJiraCommentOperations: vi.fn(),
  enqueueJiraCreateOperation: vi.fn(),
  processExternalOperation: vi.fn(),
}));
vi.mock('@/lib/audit', () => ({
  getDefaultActorId: mocks.getDefaultActorId,
  logAudit: mocks.logAudit,
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));

import {
  extractJiraWebhookEventTime,
  processJiraWebhookEvent,
} from '@/lib/jira-sync';

function link(overrides: Record<string, unknown> = {}) {
  return {
    id: 'link-1',
    provider: 'JIRA',
    incidentId: 'inc-1',
    actionItemId: null,
    externalId: 'jira-100',
    externalKey: 'OPS-100',
    externalUrl: 'https://acme.atlassian.net/browse/OPS-100',
    externalStatus: 'Done',
    externalAssignee: 'Alice',
    syncState: 'SYNCED',
    lastSyncedAt: new Date('2026-09-11T10:05:00.000Z'),
    ...overrides,
  };
}

function syncEnabledLink() {
  return {
    id: 'link-1',
    incident: { service: { jiraServiceMapping: { syncEnabled: true } } },
    actionItem: null,
  };
}

describe('Jira webhook ordering hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.externalIssueUpdateMany.mockResolvedValue({ count: 1 });
    mocks.actionItemFindMany.mockResolvedValue([]);
    mocks.incidentEventCreate.mockResolvedValue({ id: 'event-1' });
    mocks.incidentUpdate.mockResolvedValue({ id: 'inc-1' });
    mocks.getDefaultActorId.mockResolvedValue('system');
  });

  it('prefers Jira issue.updated as the provider ordering clock', () => {
    const time = extractJiraWebhookEventTime({
      timestamp: '2026-09-11T10:10:00.000Z',
      issue: {
        id: 'jira-100',
        key: 'OPS-100',
        fields: { updated: '2026-09-11T10:07:00.000Z' },
      },
    });

    expect(time?.toISOString()).toBe('2026-09-11T10:07:00.000Z');
  });

  it('rejects an older different-status webhook instead of reopening newer state', async () => {
    mocks.externalIssueFindMany
      .mockResolvedValueOnce([link()])
      .mockResolvedValueOnce([syncEnabledLink()]);

    const result = await processJiraWebhookEvent({
      webhookEvent: 'jira:issue_updated',
      timestamp: '2026-09-11T09:58:00.000Z',
      issue: {
        id: 'jira-100',
        key: 'OPS-100',
        fields: {
          updated: '2026-09-11T09:58:00.000Z',
          status: { name: 'To Do' },
        },
      },
    });

    expect(result).toEqual({ updated: 0 });
    expect(mocks.externalIssueUpdateMany).not.toHaveBeenCalled();
    expect(mocks.incidentEventCreate).not.toHaveBeenCalled();
  });

  it('marks a Jira deletion as historical failed state and preserves the key', async () => {
    mocks.externalIssueFindMany
      .mockResolvedValueOnce([link()])
      .mockResolvedValueOnce([syncEnabledLink()]);

    const result = await processJiraWebhookEvent({
      webhookEvent: 'jira:issue_deleted',
      timestamp: '2026-09-11T10:06:00.000Z',
      issue: {
        id: 'jira-100',
        key: 'OPS-100',
        fields: { updated: '2026-09-11T10:06:00.000Z' },
      },
    });

    expect(result).toEqual({ updated: 1 });
    expect(mocks.externalIssueUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['link-1'] } },
      data: {
        syncState: 'FAILED',
        externalStatus: 'Deleted in Jira',
        externalAssignee: null,
        lastSyncedAt: new Date('2026-09-11T10:06:00.000Z'),
      },
    });
    expect(mocks.incidentEventCreate).toHaveBeenCalledWith({
      data: {
        incidentId: 'inc-1',
        type: 'STATUS_CHANGE',
        message: 'Jira issue OPS-100 was deleted in Jira',
      },
    });
    expect(mocks.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'jira.issue.remote_deleted',
        entityType: 'INCIDENT',
        entityId: 'inc-1',
      })
    );
  });
});
