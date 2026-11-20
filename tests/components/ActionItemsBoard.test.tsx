import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import ActionItemsBoard, { type BoardActionItem } from '@/components/action-items/ActionItemsBoard';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/contexts/TimezoneContext', () => ({
  useTimezone: () => ({ userTimeZone: 'UTC' }),
}));

vi.mock('@/app/(app)/action-items/actions', () => ({
  updateActionItemStatus: vi.fn(async () => ({ success: true })),
}));

const day = 86_400_000;
const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function item(overrides: Partial<BoardActionItem>): BoardActionItem {
  return {
    id: 'ai-1',
    title: 'Add alerting',
    description: 'Alert on index rebuilds',
    status: 'OPEN',
    priority: 'HIGH',
    postmortemId: 'pm-1',
    postmortemTitle: 'Search outage review',
    incidentId: 'inc-1',
    incidentTitle: 'Search cluster down',
    serviceId: 'svc-1',
    serviceName: 'search',
    incidentJiraIssues: [],
    createdAt: new Date(),
    ...overrides,
  } as BoardActionItem;
}

const items = [
  item({ id: 'a', title: 'Overdue task', dueDate: isoDate(Date.now() - 5 * day) }),
  item({ id: 'b', title: 'Blocked task', status: 'BLOCKED', priority: 'LOW' }),
];

function renderBoard(props: Partial<Parameters<typeof ActionItemsBoard>[0]> = {}) {
  return render(
    <ActionItemsBoard
      actionItems={items}
      users={[]}
      canManage
      filters={{}}
      jiraCapabilitiesByServiceId={{}}
      pagination={{ currentPage: 1, totalPages: 1, totalItems: 2, itemsPerPage: 100 }}
      {...props}
    />
  );
}

describe('ActionItemsBoard directory', () => {
  beforeEach(() => window.localStorage.clear());

  it('shows the table by default with links, summary and overdue highlight', () => {
    renderBoard();
    const table = screen.getByRole('table', { name: 'Action items' });
    expect(screen.getByText('Showing 1–2 of 2')).toBeInTheDocument();
    const row = within(table).getByText('Overdue task').closest('tr')!;
    expect(within(row).getByRole('link', { name: 'Overdue task' })).toHaveAttribute(
      'href',
      '/postmortems/inc-1'
    );
    expect(within(row).getByRole('link', { name: 'Search cluster down' })).toHaveAttribute(
      'href',
      '/incidents/inc-1'
    );
    expect(within(row).getByLabelText('Overdue')).toBeInTheDocument();
    // Managers change status inline.
    expect(within(row).getByLabelText('Status of Overdue task')).toBeInTheDocument();
  });

  it('read-only viewers see a status badge instead of the inline select', () => {
    renderBoard({ canManage: false });
    const table = screen.getByRole('table', { name: 'Action items' });
    expect(within(table).queryByLabelText('Status of Overdue task')).toBeNull();
    expect(within(table).getByText('Blocked')).toBeInTheDocument();
  });

  it('switches to the kanban board and remembers it', () => {
    renderBoard();
    fireEvent.click(screen.getByRole('button', { name: 'Board view' }));
    expect(screen.queryByRole('table')).toBeNull();
    for (const column of ['Open', 'In Progress', 'Completed', 'Blocked']) {
      expect(screen.getByRole('heading', { name: column })).toBeInTheDocument();
    }
    expect(window.localStorage.getItem('opsknight:directory-view:action-items')).toBe('cards');
  });

  it('keeps the empty state for the table', () => {
    renderBoard({ actionItems: [] });
    // The view choice is also kept in memory (module scope), so reset it explicitly.
    fireEvent.click(screen.getByRole('button', { name: 'Table view' }));
    expect(screen.getByText('No action items found')).toBeInTheDocument();
  });
});
