import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import MobileBiometricGuard from '@/components/mobile/MobileBiometricGuard';
import * as appLock from '@/lib/mobile-app-lock';

vi.mock('@/lib/mobile-principal-state', () => ({
  purgeLegacyUnscopedMobileState: vi.fn(),
  readPrincipalState: vi.fn(),
  writePrincipalState: vi.fn(),
  removePrincipalState: vi.fn(),
}));

describe('MobileBiometricGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders children directly when app lock is disabled', async () => {
    vi.spyOn(appLock, 'platformAuthenticatorAvailable').mockResolvedValue(true);
    vi.spyOn(appLock, 'isAppLockEnabled').mockReturnValue(false);

    render(
      <MobileBiometricGuard>
        <div>Protected Content</div>
      </MobileBiometricGuard>
    );

    await waitFor(() => {
      expect(screen.getByText('Protected Content')).toBeInTheDocument();
    });
    expect(screen.queryByText(/OpsKnight is locked/i)).not.toBeInTheDocument();
  });

  it('shows lock screen and does not enter infinite loop when biometric verification is cancelled', async () => {
    vi.spyOn(appLock, 'platformAuthenticatorAvailable').mockResolvedValue(true);
    vi.spyOn(appLock, 'isAppLockEnabled').mockReturnValue(true);
    vi.spyOn(appLock, 'getAppLockCredentialDescriptor').mockReturnValue(undefined);

    const mockGet = vi.fn().mockRejectedValue(new Error('User cancelled'));
    Object.defineProperty(navigator, 'credentials', {
      value: { get: mockGet },
      configurable: true,
    });

    render(
      <MobileBiometricGuard>
        <div>Protected Content</div>
      </MobileBiometricGuard>
    );

    expect(await screen.findByText(/OpsKnight is locked/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(/Verification was not completed/i)).toBeInTheDocument();
    });

    // Verify navigator.credentials.get was called exactly once on mount, NOT in an infinite loop
    expect(mockGet).toHaveBeenCalledTimes(1);

    // Clicking the unlock button should trigger another single attempt
    const unlockBtn = screen.getByRole('button', { name: /Unlock with device verification/i });
    fireEvent.click(unlockBtn);

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledTimes(2);
    });
  });

  it('unlocks and reveals content when assertion succeeds', async () => {
    vi.spyOn(appLock, 'platformAuthenticatorAvailable').mockResolvedValue(true);
    vi.spyOn(appLock, 'isAppLockEnabled').mockReturnValue(true);
    vi.spyOn(appLock, 'getAppLockCredentialDescriptor').mockReturnValue(undefined);
    vi.spyOn(appLock, 'isValidAppLockAssertion').mockReturnValue(true);

    const mockGet = vi.fn().mockResolvedValue({
      rawId: new Uint8Array([1, 2, 3]).buffer,
      response: { authenticatorData: new Uint8Array([4, 5, 6]).buffer },
    });
    Object.defineProperty(navigator, 'credentials', {
      value: { get: mockGet },
      configurable: true,
    });

    render(
      <MobileBiometricGuard>
        <div>Protected Content</div>
      </MobileBiometricGuard>
    );

    await waitFor(() => {
      expect(screen.getByText('Protected Content')).toBeInTheDocument();
    });
  });

  it('recovers cleanly when biometric verification hangs indefinitely', async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(appLock, 'platformAuthenticatorAvailable').mockResolvedValue(true);
      vi.spyOn(appLock, 'isAppLockEnabled').mockReturnValue(true);
      vi.spyOn(appLock, 'getAppLockCredentialDescriptor').mockReturnValue(undefined);

      const mockGet = vi.fn().mockImplementation(() => new Promise(() => {}));
      Object.defineProperty(navigator, 'credentials', {
        value: { get: mockGet },
        configurable: true,
      });

      render(
        <MobileBiometricGuard>
          <div>Protected Content</div>
        </MobileBiometricGuard>
      );

      // Allow mount microtasks to resolve so auto-authenticate starts
      await act(async () => {
        await Promise.resolve();
      });

      expect(screen.getByText(/OpsKnight is locked/i)).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });

      expect(screen.getByText(/Verification was not completed/i)).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /Unlock with device verification/i })
      ).not.toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });
});
