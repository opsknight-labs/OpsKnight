import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import InviteUserModal from '@/components/users/InviteUserModal';

// Mock UserCreateForm
vi.mock('@/components/UserCreateForm', () => ({
  default: () => <div data-testid="user-create-form">User Create Form Content</div>,
}));

describe('InviteUserModal', () => {
  it('renders modal trigger and opens dialog with visible close button', () => {
    const dummyAction = vi.fn().mockResolvedValue({});
    render(<InviteUserModal action={dummyAction} />);

    // Click trigger to open modal
    const trigger = screen.getByRole('button', { name: /invite user/i });
    fireEvent.click(trigger);

    // Modal header and content
    expect(screen.getByText('Invite New User')).toBeInTheDocument();
    expect(screen.getByTestId('user-create-form')).toBeInTheDocument();

    // Close button has proper accessibility labels and icon
    const closeBtn = screen.getByRole('button', { name: /close dialog/i });
    expect(closeBtn).toBeInTheDocument();
    expect(closeBtn).toHaveAttribute('title', 'Close (Esc)');

    // Close button closes the dialog
    fireEvent.click(closeBtn);
    expect(screen.queryByText('Invite New User')).not.toBeInTheDocument();
  });
});
