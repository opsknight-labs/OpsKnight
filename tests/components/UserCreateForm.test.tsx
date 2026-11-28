import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import UserCreateForm from '@/components/UserCreateForm';

vi.mock('@/lib/toast', () => ({ notify: { error: vi.fn(), success: vi.fn() } }));

describe('UserCreateForm', () => {
  it('shows the result screen again for a second invite after "Invite Another Member"', async () => {
    // No email provider: the manual invite link is the only way the admin can reach the invitee.
    const action = vi
      .fn()
      .mockResolvedValueOnce({
        success: true,
        providerConfigured: false,
        inviteUrl: 'https://opsknight.test/invite/first',
        recipientEmail: 'first@example.com',
      })
      .mockResolvedValueOnce({
        success: true,
        providerConfigured: false,
        inviteUrl: 'https://opsknight.test/invite/second',
        recipientEmail: 'second@example.com',
      });
    const { container } = render(<UserCreateForm action={action} />);
    const submit = () => fireEvent.submit(container.querySelector('form') as HTMLFormElement);

    submit();
    fireEvent.click(await screen.findByRole('button', { name: /Invite Another Member/ }));
    expect(screen.queryByRole('button', { name: /Invite Another Member/ })).not.toBeInTheDocument();

    submit();

    await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByRole('button', { name: /Invite Another Member/ })
    ).toBeInTheDocument();
    expect(screen.getAllByText(/second@example\.com/).length).toBeGreaterThan(0);
  });
});
