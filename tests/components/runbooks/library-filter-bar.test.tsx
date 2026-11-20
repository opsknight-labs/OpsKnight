import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { LibraryFilterBar } from '@/components/runbooks/library/LibraryFilterBar';
import { RunbookCard, type RunbookCardData } from '@/components/runbooks/library/RunbookCard';

const SERVICE_ID = 'clh9876543210987654321098';
const push = vi.fn();
const replace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace, prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/runbooks',
}));

vi.mock('@/components/runbooks/SearchableRunbookSelect', () => ({
  SearchableRunbookSelect: ({
    ariaLabel,
    onChange,
  }: {
    ariaLabel?: string;
    onChange: (value: string) => void;
  }) => (
    <button
      type="button"
      role="combobox"
      aria-label={ariaLabel}
      aria-expanded={false}
      aria-controls="service-options"
      onClick={() => onChange(SERVICE_ID)}
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

  const counts = { all: 12, published: 7, draft: 4, archived: 2 };
  const tagsToggle = () => screen.getByRole('button', { name: /^Tags/ });

  it('keeps stable accessible names for the core filters, with no Apply button', () => {
    render(<LibraryFilterBar query={{}} teams={teams} popularTags={popularTags} counts={counts} />);
    expect(screen.getByRole('searchbox', { name: 'Search runbooks' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Quick filters' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Filter by service' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Filter by team' })).toHaveTextContent('All teams');
    expect(screen.queryByRole('button', { name: /apply filters/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /clear all/i })).not.toBeInTheDocument();
  });

  it('shows lifecycle counts and applies status immediately, dropping pagination', () => {
    render(
      <LibraryFilterBar query={{ page: '3', owner: TEAM_ID }} teams={teams} counts={counts} />
    );
    const group = screen.getByRole('group', { name: 'Quick filters' });
    expect(within(group).getByRole('button', { name: /All active\s*12/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(within(group).getByRole('button', { name: /Draft\s*4/ })).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: /Archived\s*2/ })).toBeInTheDocument();
    fireEvent.click(within(group).getByRole('button', { name: /Published\s*7/ }));
    expect(push).toHaveBeenCalledWith(`/runbooks?owner=${TEAM_ID}&status=published`);
  });

  it('toggles the active status chip back to all and clears the legacy tab param', () => {
    render(<LibraryFilterBar query={{ tab: 'archived' }} />);
    const archived = screen.getByRole('button', { name: /Archived/ });
    expect(archived).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(archived);
    expect(push).toHaveBeenLastCalledWith('/runbooks');
  });

  it('applies a service selection immediately', () => {
    render(<LibraryFilterBar query={{ status: 'draft', page: '2' }} />);
    fireEvent.click(screen.getByRole('combobox', { name: 'Filter by service' }));
    expect(push).toHaveBeenCalledWith(`/runbooks?status=draft&service=${SERVICE_ID}`);
  });

  it('keeps every tag reachable in the Tags section and toggles a single tag', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ tag: `tag-${i}`, count: 20 - i }));
    const { unmount } = render(<LibraryFilterBar query={{}} popularTags={many} />);
    fireEvent.click(tagsToggle());
    const group = screen.getByRole('group', { name: 'Filter by tag' });
    expect(within(group).getAllByRole('button')).toHaveLength(20);
    fireEvent.click(within(group).getByRole('button', { name: /^#tag-19/ }));
    expect(push).toHaveBeenCalledWith('/runbooks?tag=tag-19');
    unmount();

    // A second tag replaces the first (single-select), and the active one toggles off.
    render(<LibraryFilterBar query={{ tag: 'linux' }} popularTags={popularTags} />);
    expect(tagsToggle()).toHaveTextContent('1');
    const tags = screen.getByRole('group', { name: 'Filter by tag' });
    const linux = within(tags).getByRole('button', { name: /^#linux\s*4$/ });
    expect(linux).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(tags).getByRole('button', { name: /^#database\s*2$/ }));
    expect(push).toHaveBeenLastCalledWith('/runbooks?tag=database');
    fireEvent.click(linux);
    expect(push).toHaveBeenLastCalledWith('/runbooks');
  });

  it('shows an active tag that is not among the popular tags', () => {
    render(<LibraryFilterBar query={{ tag: 'rare' }} popularTags={popularTags} />);
    expect(screen.getByRole('button', { name: '#rare' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows "No tags yet" when the library has no tags', () => {
    render(<LibraryFilterBar query={{}} />);
    fireEvent.click(tagsToggle());
    expect(screen.getByText('No tags yet')).toBeInTheDocument();
  });

  it('removes the author filter and clears everything', () => {
    render(
      <LibraryFilterBar
        query={{ q: 'disk', team: TEAM_ID, tag: 'linux', owner: TEAM_ID }}
        teams={teams}
      />
    );
    expect(screen.getByRole('combobox', { name: 'Filter by team' })).toHaveTextContent('Platform');
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove filter: Created by a specific user' })
    );
    expect(push).toHaveBeenLastCalledWith(`/runbooks?q=disk&team=${TEAM_ID}&tag=linux`);
    fireEvent.click(screen.getByRole('button', { name: /clear all/i }));
    expect(push).toHaveBeenLastCalledWith('/runbooks');
  });

  it('debounces search with router.replace', () => {
    vi.useFakeTimers();
    try {
      render(<LibraryFilterBar query={{ status: 'draft' }} />);
      fireEvent.change(screen.getByRole('searchbox', { name: 'Search runbooks' }), {
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
