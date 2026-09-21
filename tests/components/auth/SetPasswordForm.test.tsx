import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import SetPasswordForm from '@/app/set-password/SetPasswordForm';

const mockSignOut = vi.fn();
const mockPush = vi.fn();
const mockPurgeBrowserAuthCaches = vi.fn();

vi.mock('next-auth/react', () => ({
  signOut: (...args: unknown[]) => mockSignOut(...args),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

vi.mock('@/lib/auth-cache-purge', () => ({
  purgeBrowserAuthCaches: () => mockPurgeBrowserAuthCaches(),
}));

let mockActionState = {
  error: null as string | null,
  success: false,
};

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useActionState: vi.fn((_action, initialState) => {
      return [mockActionState || initialState, vi.fn()];
    }),
  };
});

describe('SetPasswordForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignOut.mockResolvedValue({ url: '/login?password=1' });
    mockActionState = {
      error: null,
      success: false,
    };
  });

  it('renders password fields and activates submit only when strong and matching', () => {
    render(<SetPasswordForm token="valid-token-12345678901234567890" />);

    const passwordInput = screen.getByLabelText('New password');
    const confirmInput = screen.getByLabelText('Confirm password');
    const submitButton = screen.getByRole('button', { name: /Set password and activate/i });

    expect(submitButton).toBeDisabled();

    fireEvent.change(passwordInput, { target: { value: 'Weak' } });
    fireEvent.change(confirmInput, { target: { value: 'Weak' } });
    expect(submitButton).toBeDisabled();

    fireEvent.change(passwordInput, { target: { value: 'ValidPassphrase123!' } });
    fireEvent.change(confirmInput, { target: { value: 'MismatchPassphrase123!' } });
    expect(screen.getByText('Passwords do not match.')).toBeInTheDocument();
    expect(submitButton).toBeDisabled();

    fireEvent.change(confirmInput, { target: { value: 'ValidPassphrase123!' } });
    expect(screen.queryByText('Passwords do not match.')).not.toBeInTheDocument();
    expect(submitButton).toBeEnabled();
  });

  it('purges auth caches and signs out existing session then navigates to /login?password=1 upon success', async () => {
    mockActionState = {
      error: null,
      success: true,
    };

    render(<SetPasswordForm token="valid-token-12345678901234567890" />);

    expect(screen.getByText('Account activated')).toBeInTheDocument();
    expect(screen.getByText(/Your password has been set/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(mockPurgeBrowserAuthCaches).toHaveBeenCalled();
      expect(mockSignOut).toHaveBeenCalledWith({ redirect: false });
      expect(mockPush).toHaveBeenCalledWith('/login?password=1');
    });
  });

  it('signs out and navigates to /login?password=1 when user clicks continue to sign in button', async () => {
    mockActionState = {
      error: null,
      success: true,
    };

    render(<SetPasswordForm token="valid-token-12345678901234567890" />);

    const continueButton = screen.getByRole('button', { name: 'Continue to sign in' });
    fireEvent.click(continueButton);

    await waitFor(() => {
      expect(mockPurgeBrowserAuthCaches).toHaveBeenCalled();
      expect(mockSignOut).toHaveBeenCalledWith({ redirect: false });
      expect(mockPush).toHaveBeenCalledWith('/login?password=1');
    });
  });
});
