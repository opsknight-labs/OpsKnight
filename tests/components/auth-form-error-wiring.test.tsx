import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ForgotPasswordPage from '@/app/forgot-password/page';
import ResetPasswordPage from '@/app/reset-password/page';

// The brand panel animation needs ResizeObserver/rAF; it is decoration, not under test.
vi.mock('@/components/auth/LoginAnimation', () => ({ default: () => null }));
vi.mock('next/navigation', () => ({ usePathname: () => '/forgot-password' }));
vi.mock('@/lib/client-timeout', () => ({
  fetchWithTimeout: vi.fn().mockRejectedValue(new Error('offline')),
}));
vi.mock('@/components/auth/useCapabilityToken', () => ({
  useCapabilityToken: () => ({ token: 'tok', ready: true, clearToken: vi.fn() }),
}));

describe('auth form error wiring', () => {
  it('forgot-password links the email input to the rendered error', async () => {
    render(<ForgotPasswordPage />);
    const input = screen.getByLabelText('Email address');
    expect(input).toHaveAttribute('aria-describedby', 'email-help');

    fireEvent.change(input, { target: { value: 'a@b.co' } });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    const error = await screen.findByText(/Unable to submit the recovery request/);
    expect(error).toHaveAttribute('id', 'email-error');
    expect(input).toHaveAttribute('aria-describedby', 'email-error');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('reset-password links the confirm input to the mismatch message', () => {
    render(<ResetPasswordPage />);
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'one' } });
    const confirm = screen.getByLabelText('Confirm password');
    fireEvent.change(confirm, { target: { value: 'two' } });

    const message = screen.getByText('Passwords do not match');
    expect(confirm.getAttribute('aria-describedby')?.split(' ')).toContain(message.id);
    expect(confirm).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Show password' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });
});
