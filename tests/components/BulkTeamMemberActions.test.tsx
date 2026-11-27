import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock('@/lib/toast', () => ({ notify: { success: mocks.success, error: mocks.error } }));
vi.mock('@/components/UserAvatar', () => ({ default: () => null }));

import BulkTeamMemberActions from '@/components/BulkTeamMemberActions';

const users = [
  { id: 'u1', name: 'Alice', email: 'alice@example.com' },
  { id: 'u2', name: 'Bob', email: 'bob@example.com' },
  { id: 'u3', name: 'Cara', email: 'cara@example.com' },
];

describe('BulkTeamMemberActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ users, hasMore: false }) })
    );
  });

  it('tries every selected person and names the ones that could not be added', async () => {
    const addMember = vi.fn(async (formData: FormData) =>
      formData.get('userId') === 'u2' ? { error: 'Operational assignments require an active user.' } : undefined
    );
    render(
      <BulkTeamMemberActions
        teamId="team-1"
        availableUsers={users}
        canManageMembers
        canAssignOwnerAdmin={false}
        addMember={addMember}
      />
    );

    fireEvent.click(screen.getByText('Bulk Add'));
    fireEvent.click(await screen.findByRole('button', { name: 'Select Visible' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add 3 Members' }));

    await waitFor(() => expect(addMember).toHaveBeenCalledTimes(3));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('1 member could not be added');
    expect(alert.textContent).toContain('Bob: Operational assignments require an active user.');
    expect(mocks.success).toHaveBeenCalledWith('Successfully added 2 members');
    // Only the failed person stays selected, so a retry targets just them.
    expect(screen.getByRole('button', { name: 'Add 1 Member' })).toBeTruthy();
  });

  it('keeps going when one add throws', async () => {
    const addMember = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(undefined);
    render(
      <BulkTeamMemberActions
        teamId="team-1"
        availableUsers={users}
        canManageMembers
        canAssignOwnerAdmin={false}
        addMember={addMember}
      />
    );

    fireEvent.click(screen.getByText('Bulk Add'));
    fireEvent.click(await screen.findByRole('button', { name: 'Select Visible' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add 3 Members' }));

    await waitFor(() => expect(addMember).toHaveBeenCalledTimes(3));
    expect((await screen.findByRole('alert')).textContent).toContain('Alice');
  });
});
