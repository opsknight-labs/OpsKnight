import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { LibraryFilterBar } from '@/components/runbooks/library/LibraryFilterBar';
import { RunbookCard, type RunbookCardData } from '@/components/runbooks/library/RunbookCard';

const push = vi.fn();
const replace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace, prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/runbooks',
}));

vi.mock('@/components/runbooks/SearchableRunbookSelect', () => ({
  SearchableRunbookSelect: ({ ariaLabel }: { ariaLabel?: string }) => (
    <button
      type="button"
      role="combobox"
      aria-label={ariaLabel}
      aria-expanded={false}
      aria-controls="service-options"
    />
  ),
}));

const TEAM_ID = 'clh1234567890123456789012';
const teams = [{ id: TEAM_ID, name: 'Platform' }];
const popularTags = [
  { tag: 'linux', count: 4 },
  { tag: 'database', count: 2 },
];

describe('LibraryFilterBar', () => {
  beforeEach(() => {
    push.mockClear();
    replace.mockClear();
  });

  it('keeps stable accessible names for the core filters', () => {
    render(<LibraryFilterBar query={{}} teams={teams} popularTags={popularTags} />);
    expect(screen.getByRole('textbox', { name: 'Search runbooks' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Filter by status' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Filter by service' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Filter by team' })).toHaveTextContent('All teams');
    expect(screen.getByRole('button', { name: 'Apply filters' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reset/i })).not.toBeInTheDocument();
  });

  it('applies status from the segmented control and drops pagination', () => {
    render(<LibraryFilterBar query={{ page: '3', owner: TEAM_ID }} teams={teams} />);
    const group = screen.getByRole('group', { name: 'Filter by status' });
    expect(within(group).getByRole('button', { name: 'All active' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    fireEvent.click(within(group).getByRole('button', { name: 'Published' }));
    expect(push).toHaveBeenCalledWith(`/runbooks?owner=${TEAM_ID}&status=published`);
  });

  it('filters by a popular tag and removes the active tag', () => {
    const { unmount } = render(<LibraryFilterBar query={{}} popularTags={popularTags} />);
    fireEvent.click(screen.getByRole('button', { name: 'Filter by tag linux' }));
    expect(push).toHaveBeenCalledWith('/runbooks?tag=linux');
    unmount();

    render(<LibraryFilterBar query={{ tag: 'linux' }} popularTags={popularTags} />);
    expect(screen.queryByRole('button', { name: 'Filter by tag linux' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove tag filter linux' }));
    expect(push).toHaveBeenLastCalledWith('/runbooks');
  });

  it('shows active filter count and resets everything', () => {
    render(
      <LibraryFilterBar
        query={{ q: 'disk', team: TEAM_ID, tag: 'linux', owner: TEAM_ID }}
        teams={teams}
      />
    );
    expect(screen.getByText('4 filters active')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Filter by team' })).toHaveTextContent('Platform');
    fireEvent.click(screen.getByRole('button', { name: /reset/i }));
    expect(push).toHaveBeenLastCalledWith('/runbooks');
  });

  it('debounces search with router.replace', () => {
    vi.useFakeTimers();
    try {
      render(<LibraryFilterBar query={{ status: 'draft' }} />);
      fireEvent.change(screen.getByRole('textbox', { name: 'Search runbooks' }), {
        target: { value: 'restart' },
      });
      expect(replace).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(replace).toHaveBeenCalledWith('/runbooks?status=draft&q=restart');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('RunbookCard', () => {
  const base: RunbookCardData = {
    id: 'rb1',
    name: 'Disk cleanup',
    description: 'Free space',
    publishedVersion: 2,
    draftVersion: null,
    bindings: 1,
    executions: 3,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  it('links the title and renders owner team and tag chips', () => {
    render(
      <RunbookCard
        runbook={{ ...base, ownerTeam: { id: TEAM_ID, name: 'Platform' }, tags: ['linux', 'p1'] }}
        userTimeZone="UTC"
      />
    );
    expect(screen.getByRole('link', { name: 'Disk cleanup' })).toHaveAttribute(
      'href',
      '/runbooks/rb1'
    );
    expect(screen.getByText('Platform')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Filter by tag linux' })).toHaveAttribute(
      'href',
      '/runbooks?tag=linux'
    );
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/runbooks/rb1');
  });

  it('shows No owner when the runbook has no owner team', () => {
    render(<RunbookCard runbook={base} userTimeZone="UTC" />);
    expect(screen.getByText('No owner')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Tags' })).not.toBeInTheDocument();
  });
});
