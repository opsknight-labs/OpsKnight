import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import MobileBiometricToggle from '@/components/mobile/MobileBiometricToggle';

vi.mock('@/lib/mobile-app-lock', () => ({
  isAppLockEnabled: vi.fn().mockReturnValue(false),
  platformAuthenticatorAvailable: vi.fn().mockResolvedValue(true),
  persistAppLockCredential: vi.fn(),
  setAppLockEnabled: vi.fn(),
  getOrCreateAppLockUserHandle: vi.fn().mockReturnValue(new Uint8Array(32)),
}));

vi.mock('@/lib/mobile-principal-state', () => ({
  purgeLegacyUnscopedMobileState: vi.fn(),
}));

describe('MobileBiometricToggle', () => {
  // Regression guard: a 44px-tall wrapper `<div>` around the switch does not
  // enlarge what's actually clickable. The real interactive element (the
  // switch button itself) must own the 44x44 hit target.
  it('renders a real 44x44 switch hit target, not just a padded wrapper', async () => {
    render(<MobileBiometricToggle />);

    const toggle = await screen.findByRole('switch', {
      name: 'Require device verification when reopening OpsKnight',
    });

    await waitFor(() => expect(toggle).not.toBeDisabled());

    expect(toggle.className).toContain('h-11');
    expect(toggle.className).toContain('w-11');

    const visualTrack = toggle.querySelector('[aria-hidden="true"]');
    expect(visualTrack).toBeTruthy();
    expect(visualTrack?.className).toContain('h-6');
    expect(visualTrack?.className).toContain('w-11');
  });
});
