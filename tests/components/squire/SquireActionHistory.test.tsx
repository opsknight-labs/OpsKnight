import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import SquireActionHistory from '@/components/squire/SquireActionHistory';
import type { ActionHistoryPage } from '@/lib/intelligence/squire/actions/history';

const row = (id: string, extra: Partial<ActionHistoryPage['rows'][number]> = {}) => ({
  id,
  at: '2026-11-20T10:00:00.000Z',
  action: 'Acknowledge incident',
  status: 'SUCCEEDED' as const,
  message: `Done ${id}`,
  ...extra,
});

describe('SquireActionHistory', () => {
  it('renders an accessible table with status, incident links and a "Who" column for everyone', () => {
    render(
      <SquireActionHistory
        initial={{
          scope: 'everyone',
          canSeeEveryone: true,
          nextCursor: null,
          rows: [
            row('a', { who: 'Ada', href: '/incidents/1' }),
            row('b', { who: 'Uma', action: 'Update a service', status: 'FAILED' }),
          ],
        }}
        loadMore={vi.fn()}
      />
    );
    const table = screen.getByRole('table', { name: /actions confirmed from squire/i });
    expect(within(table).getByRole('columnheader', { name: 'Who' })).toBeTruthy();
    expect(
      within(table).getByRole('link', { name: 'Acknowledge incident' }).getAttribute('href')
    ).toBe('/incidents/1');
    expect(within(table).queryByRole('link', { name: 'Update a service' })).toBeNull();
    expect(within(table).getByText('Failed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /load more/i })).toBeNull();
  });

  it('appends the next page on "Load more" and hides the button at the end', async () => {
    const loadMore = vi.fn(async () => ({
      scope: 'mine' as const,
      canSeeEveryone: false,
      nextCursor: null,
      rows: [row('c')],
    }));
    render(
      <SquireActionHistory
        initial={{ scope: 'mine', canSeeEveryone: false, nextCursor: 'a', rows: [row('a')] }}
        status="SUCCEEDED"
        loadMore={loadMore}
      />
    );
    expect(screen.queryByRole('columnheader', { name: 'Who' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /load more/i }));
    await waitFor(() => expect(screen.getByText('Done c')).toBeTruthy());
    expect(screen.getByText('Done a')).toBeTruthy();
    expect(loadMore).toHaveBeenCalledWith({ scope: 'mine', status: 'SUCCEEDED', cursor: 'a' });
    expect(screen.queryByRole('button', { name: /load more/i })).toBeNull();
  });

  it('says so when there is nothing yet', () => {
    render(
      <SquireActionHistory
        initial={{ scope: 'mine', canSeeEveryone: false, nextCursor: null, rows: [] }}
        loadMore={vi.fn()}
      />
    );
    expect(screen.getByText('No actions yet.')).toBeTruthy();
  });
});
