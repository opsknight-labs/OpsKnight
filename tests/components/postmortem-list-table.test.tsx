import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PostmortemsListTable from '@/components/postmortem/PostmortemsListTable';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/postmortems',
}));
vi.mock('@/contexts/TimezoneContext', () => ({
  useTimezone: () => ({ userTimeZone: 'UTC' }),
}));
vi.mock('@/app/(app)/postmortems/actions', () => ({
  deletePostmortem: vi.fn(),
  bulkDeletePostmortems: vi.fn(),
}));

const pagination = { currentPage: 1, totalPages: 1, totalItems: 1, itemsPerPage: 20 };

const postmortem = {
  id: 'pm-1',
  title: 'Index rebuild caused empty results',
  status: 'PUBLISHED',
  isPublic: true,
  createdAt: new Date('2026-11-16T11:46:00Z'),
  updatedAt: new Date('2026-11-16T11:46:00Z'),
  publishedAt: new Date('2026-11-16T11:46:00Z'),
  incidentId: 'inc-1',
  createdBy: { id: 'u-1', name: 'System Admin', email: 'admin@example.com', avatarUrl: null },
  incident: {
    id: 'inc-1',
    title: 'Search Cluster: index rebuild',
    status: 'RESOLVED',
    resolvedAt: new Date('2026-11-16T10:00:00Z'),
    service: { id: 'svc-1', name: 'Search Cluster' },
  },
};

describe('PostmortemsListTable', () => {
  it('links each row to its postmortem and to the incident, with the incident status', () => {
    render(<PostmortemsListTable postmortems={[postmortem]} pagination={pagination} canManage />);
    const table = screen.getByRole('table');
    expect(within(table).getByRole('link', { name: postmortem.title })).toHaveAttribute(
      'href',
      '/postmortems/inc-1'
    );
    expect(within(table).getByRole('link', { name: postmortem.incident.title })).toHaveAttribute(
      'href',
      '/incidents/inc-1'
    );
    expect(within(table).getByText('Resolved')).toBeInTheDocument();
    expect(
      within(table).getByRole('button', { name: `Actions for ${postmortem.title}` })
    ).toBeInTheDocument();
    expect(
      within(table).getByRole('checkbox', { name: `Select ${postmortem.title}` })
    ).toBeVisible();
    expect(table.querySelector('time')).toHaveAttribute('dateTime');
  });

  it('offers "Clear filters" when filters return nothing', () => {
    render(<PostmortemsListTable postmortems={[]} pagination={pagination} canManage hasFilters />);
    expect(
      screen.getByRole('heading', { name: 'No postmortems match these filters' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });

  it('teaches the first postmortem and shows the create action', () => {
    render(
      <PostmortemsListTable
        postmortems={[]}
        pagination={pagination}
        canManage
        createAction={<button type="button">New postmortem</button>}
      />
    );
    expect(screen.getByRole('heading', { name: 'No postmortems yet' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New postmortem' })).toBeInTheDocument();
  });
});
