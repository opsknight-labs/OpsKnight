import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import EmergencyLogin from '@/components/auth/EmergencyLogin';
const request = vi.hoisted(() =>
  vi.fn().mockRejectedValue(new Error('Fixture authentication failure'))
);
vi.mock('@/components/settings/AuthenticationConsole', () => ({ authenticationRequest: request }));
vi.mock('@/hooks/useHydrated', () => ({ useHydrated: () => true }));
describe('independent emergency password form', () => {
  it('offers local method selection without an account-discovery request, and clears submitted passwords', async () => {
    render(<EmergencyLogin legacyAvailable={false} />);
    fireEvent.change(screen.getByLabelText('Recovery method'), { target: { value: 'PASSWORD' } });
    expect(request).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Emergency account identifier'), {
      target: { value: 'recovery-custodian' },
    });
    fireEvent.change(screen.getByLabelText('Recovery password'), {
      target: { value: 'test-password-only-fixture' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to recovery' }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        {
          action: 'passwordLogin',
          accountId: 'recovery-custodian',
          password: 'test-password-only-fixture',
        },
        '/api/auth/emergency'
      )
    );
    await waitFor(() => expect(screen.getByLabelText('Recovery password')).toHaveValue(''));
    expect(screen.getByRole('alert')).toHaveTextContent('Fixture authentication failure');
  });
});
