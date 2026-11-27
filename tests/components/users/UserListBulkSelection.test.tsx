import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/users',
}));

import UserList from '@/components/users/UserList';

const person = (id: string, name: string) => ({
  id,
  name,
  email: `${id}@example.com`,
  role: 'USER',
  status: 'ACTIVE',
});
const pageOne = [person('u1', 'Alice'), person('u2', 'Bob')];
const pageTwo = [person('u3', 'Carol'), person('u4', 'Dan')];

const noop = vi.fn(async () => undefined);

function list(users: ReturnType<typeof person>[], bulkUpdateUsers = vi.fn()) {
  return (
    <UserList
      users={users}
      currentUserId="me"
      isAdmin
      teams={[]}
      updateUserRole={noop}
      addUserToTeam={noop}
      deactivateUser={noop}
      reactivateUser={noop}
      deleteUser={noop}
      generateInvite={vi.fn(async () => ({ error: null }))}
      getUserDependencyReport={vi.fn(async () => ({}))}
      bulkUpdateUsers={bulkUpdateUsers}
    />
  );
}

describe('UserList bulk selection', () => {
  it('drops a selection once those users are no longer on screen', () => {
    const { rerender } = render(list(pageOne));
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'Select Alice' })[0]);
    expect(screen.getByText('1 selected')).toBeInTheDocument();

    rerender(list(pageTwo));
    expect(screen.queryByText(/selected$/)).toBeNull();

    // Back on the first page the selection is on screen again, ticked and counted.
    rerender(list(pageOne));
    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });

  it('asks before a bulk deactivate and names who is affected', async () => {
    const bulkUpdateUsers = vi.fn(async () => ({ success: true, message: 'Deactivated 1 user' }));
    render(list(pageOne, bulkUpdateUsers));
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'Select Alice' })[0]);

    const actions = screen.getByRole('button', { name: /Actions/ });
    fireEvent.pointerDown(actions, { button: 0, pointerType: 'mouse' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Deactivate' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Deactivate 1 user?')).toBeInTheDocument();
    expect(within(dialog).getByText(/Alice/)).toBeInTheDocument();
    expect(bulkUpdateUsers).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(bulkUpdateUsers).toHaveBeenCalledTimes(1));
  });
});
