import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/TeamMemberForm', () => ({
  default: ({ addMember }: { addMember: (formData: FormData) => Promise<unknown> }) => (
    <button type="button" onClick={() => addMember(new FormData())}>
      single add
    </button>
  ),
}));
vi.mock('@/components/BulkTeamMemberActions', () => ({
  default: ({ addMember }: { addMember: (formData: FormData) => Promise<unknown> }) => (
    <button type="button" onClick={() => addMember(new FormData())}>
      bulk add
    </button>
  ),
}));

import TeamMemberAddModal from '@/components/teams/TeamMemberAddModal';

describe('TeamMemberAddModal', () => {
  it('closes after a single add but stays open while a bulk add works through the list', async () => {
    const addMember = vi.fn().mockResolvedValue(undefined);
    render(
      <TeamMemberAddModal
        teamId="team-1"
        availableUsers={[]}
        canManageMembers
        canAssignOwnerAdmin={false}
        addMember={addMember}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /add member/i }));
    fireEvent.mouseDown(await screen.findByRole('tab', { name: /bulk add/i }));
    fireEvent.click(await screen.findByText('bulk add'));
    await waitFor(() => expect(addMember).toHaveBeenCalledWith('team-1', expect.any(FormData)));
    expect(screen.getByRole('dialog')).toBeTruthy();

    fireEvent.mouseDown(screen.getByRole('tab', { name: /single user/i }));
    fireEvent.click(await screen.findByText('single add'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
