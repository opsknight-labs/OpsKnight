import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AuthenticationPolicySettings from '@/components/settings/AuthenticationPolicySettings';
import { changeAuthenticationMode } from '@/app/(app)/settings/system/authentication-actions';

vi.mock('@/app/(app)/settings/system/authentication-actions', () => ({
  changeAuthenticationMode: vi.fn(),
}));

describe('authentication policy settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requires acknowledgment and keeps unsafe Required activation unavailable', () => {
    render(
      <AuthenticationPolicySettings
        initialMode="PASSWORD_ONLY"
        initialVersion={1}
        legacyEmergencyConfigured={false}
      />
    );
    expect(screen.getByRole('option', { name: 'SSO Required' })).toBeDisabled();
    fireEvent.change(screen.getByRole('combobox', { name: 'Sign-in mode' }), {
      target: { value: 'SSO_OPTIONAL' },
    });
    expect(screen.getByRole('button', { name: 'Change authentication policy' })).toBeDisabled();
    expect(changeAuthenticationMode).not.toHaveBeenCalled();
  });

  it('submits the expected version and displays only the committed server mode', async () => {
    vi.mocked(changeAuthenticationMode).mockResolvedValue({ mode: 'SSO_OPTIONAL', version: 2 });
    render(
      <AuthenticationPolicySettings
        initialMode="PASSWORD_ONLY"
        initialVersion={1}
        legacyEmergencyConfigured={false}
      />
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'SSO_OPTIONAL' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Change authentication policy' }));
    await waitFor(() =>
      expect(changeAuthenticationMode).toHaveBeenCalledWith({
        mode: 'SSO_OPTIONAL',
        expectedVersion: 1,
        confirmation: 'CHANGE AUTHENTICATION POLICY',
      })
    );
    await waitFor(() => expect(screen.getByText(/Current mode: SSO Optional/)).toBeInTheDocument());
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });

  it('retains the current policy and explains a rejected concurrent edit', async () => {
    vi.mocked(changeAuthenticationMode).mockRejectedValue(
      new Error('Authentication policy changed elsewhere. Reload before retrying.')
    );
    render(
      <AuthenticationPolicySettings
        initialMode="PASSWORD_ONLY"
        initialVersion={1}
        legacyEmergencyConfigured={false}
      />
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'SSO_OPTIONAL' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Change authentication policy' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('changed elsewhere'));
    expect(screen.getByText(/Current mode: Password Only/)).toBeInTheDocument();
  });
});
