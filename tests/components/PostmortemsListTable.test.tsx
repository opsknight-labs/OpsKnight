import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import PostmortemsListTable from '@/components/postmortem/PostmortemsListTable';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/postmortems',
}));

vi.mock('@/contexts/TimezoneContext', () => ({
  useTimezone: () => ({ userTimeZone: 'UTC' }),
}));

const mocks = vi.hoisted(() => ({
  bulkDeletePostmortems: vi.fn(),
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}));

vi.mock('@/app/(app)/postmortems/actions', () => ({
  deletePostmortem: vi.fn(),
  bulkDeletePostmortems: mocks.bulkDeletePostmortems,
}));
vi.mock('@/lib/toast', () => ({
  notify: { error: mocks.notifyError, success: mocks.notifySuccess },
}));

const pm = {
  id: 'pm-1',
  title: 'Search outage review',
  status: 'DRAFT',
  isPublic: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  publishedAt: null,
  incidentId: 'inc-1',
  createdBy: { id: 'u1', name: 'Ada', email: 'ada@example.com', avatarUrl: null },
  incident: {
    id: 'inc-1',
    title: 'Search cluster down',
    status: 'RESOLVED',
    urgency: 'HIGH',
    priority: null,
    resolvedAt: new Date(),
    service: { id: 's1', name: 'search' },
  },
  _count: { actionItemRecords: 3 },
};

const pagination = { currentPage: 1, totalPages: 1, totalItems: 1, itemsPerPage: 50 };

describe('PostmortemsListTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  const deleteSelected = async () => {
    render(<PostmortemsListTable postmortems={[pm]} pagination={pagination} canManage />);
    const table = screen.getByRole('table', { name: 'Postmortems' });
    fireEvent.click(within(table).getByRole('checkbox', { name: 'Select Search outage review' }));
    fireEvent.click(screen.getByRole('button', { name: /Delete Selected \(1\)/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
  };

  it('shows the reason and keeps the selection when the bulk delete is refused', async () => {
    mocks.bulkDeletePostmortems.mockResolvedValue({
      success: false,
      error: 'Only administrators or the postmortem author can delete the selected records',
    });

    await deleteSelected();

    await waitFor(() =>
      expect(mocks.notifyError).toHaveBeenCalledWith(
        'Only administrators or the postmortem author can delete the selected records'
      )
    );
    expect(mocks.notifySuccess).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Delete Selected \(1\)/ })).toBeInTheDocument();
  });

  it('confirms how many postmortems were deleted', async () => {
    mocks.bulkDeletePostmortems.mockResolvedValue({ success: true, count: 1 });

    await deleteSelected();

    await waitFor(() => expect(mocks.notifySuccess).toHaveBeenCalledWith('Deleted 1 postmortem.'));
  });

  it('renders the table with incident subtitle, visibility, author and item count', () => {
    render(<PostmortemsListTable postmortems={[pm]} pagination={pagination} canManage />);
    const table = screen.getByRole('table', { name: 'Postmortems' });
    expect(within(table).getByRole('link', { name: 'Search outage review' })).toHaveAttribute(
      'href',
      '/postmortems/inc-1'
    );
    expect(within(table).getByRole('link', { name: 'Search cluster down' })).toHaveAttribute(
      'href',
      '/incidents/inc-1'
    );
    expect(within(table).getByText('Private')).toBeInTheDocument();
    expect(within(table).getByText('Ada')).toBeInTheDocument();
    expect(within(table).getByTitle('3 action items')).toBeInTheDocument();
  });

  it('selecting rows shows the bulk delete bar (managers only)', () => {
    const { rerender } = render(
      <PostmortemsListTable postmortems={[pm]} pagination={pagination} canManage />
    );
    const table = screen.getByRole('table', { name: 'Postmortems' });
    fireEvent.click(within(table).getByRole('checkbox', { name: 'Select Search outage review' }));
    expect(screen.getByRole('button', { name: /Delete Selected \(1\)/ })).toBeInTheDocument();

    rerender(<PostmortemsListTable postmortems={[pm]} pagination={pagination} canManage={false} />);
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('offers compact cards as the alternative view', () => {
    render(<PostmortemsListTable postmortems={[pm]} pagination={pagination} canManage />);
    fireEvent.click(screen.getByRole('button', { name: 'Card view' }));
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('link', { name: 'Search outage review' })).toBeInTheDocument();
  });
});
