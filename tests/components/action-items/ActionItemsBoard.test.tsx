import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ActionItemStatus, ActionItemPriority } from '@prisma/client';
import ActionItemsBoard, { type BoardActionItem } from '@/components/action-items/ActionItemsBoard';
import { deriveJiraCapability } from '@/lib/jira-capabilities';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/action-items',
}));
vi.mock('@/contexts/TimezoneContext', () => ({
  useTimezone: () => ({ userTimeZone: 'UTC' }),
}));
vi.mock('@/app/(app)/action-items/actions', () => ({
  updateActionItemStatus: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock('@/app/(app)/action-items/jira/actions', () => ({
  createJiraIssueFromActionItem: vi.fn(),
  linkJiraIssueToActionItem: vi.fn(),
  unlinkJiraIssueFromActionItem: vi.fn(),
  syncActionItemJiraIssue: vi.fn(),
}));

const item: BoardActionItem = {
  id: 'ai-1',
  title: 'Add a canary for the index rebuild',
  description: 'Catch empty results before full rollout.',
  status: ActionItemStatus.OPEN,
  priority: ActionItemPriority.HIGH,
  owner: 'user-1',
  ownerName: 'Maya Smith',
  postmortemId: 'pm-1',
  postmortemTitle: 'Index rebuild outage',
  incidentId: 'inc-1',
  incidentTitle: 'Search returns empty results',
  serviceId: 'svc-1',
  serviceName: 'Search Cluster',
  incidentJiraIssues: [],
  createdAt: new Date('2026-11-01T00:00:00Z'),
};

const capability = deriveJiraCapability({
  workspaceState: 'ENABLED',
  canManage: true,
  serviceMapped: true,
  syncEnabled: true,
  rawEnabled: true,
});

function renderBoard(
  props: Partial<React.ComponentProps<typeof ActionItemsBoard>> = {}
): ReturnType<typeof render> {
  return render(
    <ActionItemsBoard
      actionItems={[item]}
      users={[{ id: 'user-1', name: 'Maya Smith', email: 'maya@example.com' }]}
      canManage
      view="board"
      filters={{}}
      jiraCapabilitiesByServiceId={{ 'svc-1': capability }}
      {...props}
    />
  );
}

const NESTED_INTERACTIVE =
  'a a, a button, button a, button button, [role="button"] a, [role="button"] button';

describe('ActionItemsBoard', () => {
  it.each(['board', 'list'] as const)(
    'renders %s cards as one postmortem link plus separate controls, never nested',
    view => {
      const { container } = renderBoard({ view });

      expect(container.querySelectorAll('[role="button"]')).toHaveLength(0);
      expect(container.querySelectorAll(NESTED_INTERACTIVE)).toHaveLength(0);
      expect(screen.getByRole('link', { name: item.title })).toHaveAttribute(
        'href',
        '/postmortems/inc-1'
      );
      expect(screen.getByRole('link', { name: item.incidentTitle })).toHaveAttribute(
        'href',
        '/incidents/inc-1'
      );
    }
  );

  it('labels the status menu with the item it changes', () => {
    renderBoard();
    expect(
      screen.getByRole('button', { name: `Change status of ${item.title}` })
    ).toBeInTheDocument();
  });

  it('offers "Clear filters" when filters hide every item', () => {
    renderBoard({ actionItems: [], filters: { status: 'BLOCKED' } });
    const empty = screen.getByRole('heading', { name: 'No action items match these filters' });
    expect(empty).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });

  it('teaches where action items come from when there are none', () => {
    renderBoard({ actionItems: [] });
    expect(screen.getByRole('heading', { name: 'No action items yet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to postmortems' })).toHaveAttribute(
      'href',
      '/postmortems'
    );
    // No empty kanban columns when there is nothing to show.
    expect(screen.queryByRole('region', { name: 'Open' })).not.toBeInTheDocument();
  });

  it('labels every filter control', () => {
    renderBoard();
    const filters = screen.getByRole('region', { name: 'Filters' });
    expect(within(filters).getByRole('searchbox', { name: 'Search action items' })).toBeVisible();
    expect(within(filters).getByLabelText('Status')).toBeInTheDocument();
    expect(within(filters).getByLabelText('Owner')).toBeInTheDocument();
    expect(within(filters).getByLabelText('Priority')).toBeInTheDocument();
  });
});
