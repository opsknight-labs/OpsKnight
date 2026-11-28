import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('@/lib/toast', () => ({ notify: { error: mocks.error, success: vi.fn() } }));

import IncidentWatchers from '@/components/incident/detail/IncidentWatchers';

const bob = { id: 'bob', name: 'Bob', email: 'bob@example.com' };
const watchers = [{ id: 'watcher-1', user: bob, role: 'FOLLOWER' }];

beforeEach(() => mocks.error.mockReset());

it('shows a toast instead of throwing when removing a watcher fails', async () => {
  const onRemoveWatcher = vi.fn().mockRejectedValue(new Error('Watcher not found'));
  render(
    <IncidentWatchers
      watchers={watchers}
      users={[bob]}
      canManage
      currentUserId="u1"
      onAddWatcher={vi.fn()}
      onRemoveWatcher={onRemoveWatcher}
    />
  );

  fireEvent.click(screen.getByRole('button', { name: 'Remove Bob' }));

  await waitFor(() => expect(mocks.error).toHaveBeenCalledTimes(1));
  expect(onRemoveWatcher).toHaveBeenCalledTimes(1);
  // The card is still on screen: nothing replaced it with an error screen.
  expect(screen.getByText('Subscribers')).toBeInTheDocument();
});

it('shows a toast instead of throwing when subscribing yourself fails', async () => {
  const onAddWatcher = vi.fn().mockRejectedValue(new Error('Access denied'));
  render(
    <IncidentWatchers
      watchers={[]}
      users={[bob]}
      canManage={false}
      currentUserId="u1"
      onAddWatcher={onAddWatcher}
      onRemoveWatcher={vi.fn()}
    />
  );

  fireEvent.click(screen.getByRole('button', { name: /^Subscribe$/ }));

  await waitFor(() => expect(mocks.error).toHaveBeenCalledTimes(1));
  expect(screen.getByText('Subscribers')).toBeInTheDocument();
});
