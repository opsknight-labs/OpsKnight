import { describe, expect, it } from 'vitest';
import {
  formatActionItemDueDate,
  getStoredActionItemId,
  normalizeActionItems,
  normalizeLegacyActionItems,
  parseActionItemDueDate,
  resolveStoredActionItems,
} from '@/lib/action-items';

describe('action item compatibility helpers', () => {
  it('normalizes legacy JSON into the stable UI shape', () => {
    const items = normalizeLegacyActionItems(
      [
        {
          id: 'legacy-1',
          title: 'Add alert coverage',
          description: 'Cover cache saturation',
          owner: 'user-1',
          dueDate: '2026-05-24T12:45:00.000Z',
          status: 'IN_PROGRESS',
          priority: 'HIGH',
        },
        {
          id: '',
          title: 42,
          status: 'unknown',
          priority: 'unknown',
        },
      ],
      { legacyIdPrefix: 'pm-1' }
    );

    expect(items).toEqual([
      {
        id: 'legacy-1',
        title: 'Add alert coverage',
        description: 'Cover cache saturation',
        owner: 'user-1',
        dueDate: '2026-05-24',
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        completedAt: undefined,
      },
      {
        id: 'pm-1-1',
        title: '',
        description: '',
        owner: undefined,
        dueDate: undefined,
        status: 'OPEN',
        priority: 'MEDIUM',
        completedAt: undefined,
      },
    ]);
  });

  it('preserves Jira linkage when an already-normalized action item crosses another UI boundary', () => {
    const [item] = normalizeActionItems([
      {
        id: 'ai-1',
        title: 'Rotate signing key',
        description: 'Complete the rotation',
        owner: 'user-1',
        dueDate: '2026-09-18',
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        externalIssue: {
          linkId: 'link-1',
          provider: 'JIRA',
          key: 'OPS-123',
          url: 'https://acme.atlassian.net/browse/OPS-123',
          status: 'In Progress',
          assignee: 'Ada',
          syncState: 'SYNCED',
        },
      },
    ]);

    expect(item).toMatchObject({
      id: 'ai-1',
      owner: 'user-1',
      externalIssue: {
        linkId: 'link-1',
        provider: 'JIRA',
        key: 'OPS-123',
        url: 'https://acme.atlassian.net/browse/OPS-123',
        status: 'In Progress',
        assignee: 'Ada',
        syncState: 'SYNCED',
      },
    });
  });

  it('normalizes Prisma-style action item rows without losing owner or Jira linkage', () => {
    const [item] = normalizeActionItems([
      {
        id: 'ai-2',
        title: 'Add timeout',
        description: null,
        ownerId: 'user-2',
        dueDate: new Date('2026-09-20T00:00:00.000Z'),
        status: 'OPEN',
        priority: 'MEDIUM',
        externalIssueLinks: [
          {
            id: 'link-2',
            provider: 'JIRA',
            externalKey: 'OPS-456',
            externalUrl: 'https://acme.atlassian.net/browse/OPS-456',
            externalStatus: 'To Do',
            externalAssignee: 'Grace',
            syncState: 'SYNCED',
          },
        ],
      },
    ]);

    expect(item).toMatchObject({
      id: 'ai-2',
      owner: 'user-2',
      dueDate: '2026-09-20',
      externalIssue: {
        linkId: 'link-2',
        key: 'OPS-456',
        status: 'To Do',
        assignee: 'Grace',
      },
    });
  });

  it('prefers normalized records over legacy JSON to prevent duplicate reads', () => {
    const items = resolveStoredActionItems({
      records: [
        {
          id: 'ai-postmortem-1-legacy-1',
          title: 'Normalized row',
          description: null,
          ownerId: null,
          dueDate: null,
          status: 'OPEN',
          priority: 'MEDIUM',
          externalIssueLinks: [
            {
              id: 'link-1',
              provider: 'JIRA',
              externalKey: 'OPS-123',
              externalUrl: 'https://example.atlassian.net/browse/OPS-123',
              externalStatus: 'To Do',
              externalAssignee: 'Ada',
              syncState: 'SYNCED',
            },
          ],
        },
      ],
      legacy: [
        {
          id: 'legacy-1',
          title: 'Legacy row',
          status: 'COMPLETED',
          priority: 'HIGH',
        },
      ],
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'ai-postmortem-1-legacy-1',
      title: 'Normalized row',
      externalIssue: {
        linkId: 'link-1',
        provider: 'JIRA',
        key: 'OPS-123',
        status: 'To Do',
        assignee: 'Ada',
        syncState: 'SYNCED',
      },
    });
  });

  it('creates deterministic namespaced ids for backfill and server writes', () => {
    const first = getStoredActionItemId({
      postmortemId: 'pm_123',
      legacyId: 'action:legacy/1',
      index: 0,
    });
    const second = getStoredActionItemId({
      postmortemId: 'pm_123',
      legacyId: 'action:legacy/1',
      index: 0,
    });

    expect(first).toBe(second);
    expect(first).toBe('ai_pm_123_action_legacy_1');
  });

  it('does not re-namespace ids that are already stored ids', () => {
    expect(
      getStoredActionItemId({
        postmortemId: 'pm_123',
        legacyId: 'ai_pm_123_action_legacy_1',
        index: 0,
      })
    ).toBe('ai_pm_123_action_legacy_1');
  });

  it('round-trips date-only due dates using UTC boundaries', () => {
    const parsed = parseActionItemDueDate('2026-05-24');

    expect(parsed?.toISOString()).toBe('2026-05-24T00:00:00.000Z');
    expect(formatActionItemDueDate(parsed)).toBe('2026-05-24');
  });
});
