import { describe, expect, it } from 'vitest';
import {
  formatActionItemDueDate,
  getStoredActionItemId,
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
      },
      {
        id: 'pm-1-1',
        title: '',
        description: '',
        owner: undefined,
        dueDate: undefined,
        status: 'OPEN',
        priority: 'MEDIUM',
      },
    ]);
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
