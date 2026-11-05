import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SignOutClient from '@/app/auth/signout/signout-client';
import { forcedSignOutUrl } from '@/lib/app-routes';

const mockSignOut = vi.fn();
let mockSearch = '';

vi.mock('next-auth/react', () => ({
  signOut: (...args: unknown[]) => mockSignOut(...args),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

vi.mock('@/lib/auth-cache-purge', () => ({
  purgeBrowserAuthCaches: vi.fn().mockResolvedValue(undefined),
}));

describe('SignOutClient forced sign-out', () => {
  const assign = vi.fn();
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockSignOut.mockResolvedValue({ url: '/m/login' });
    fetchMock.mockResolvedValue(Response.json({ url: null }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('location', { ...window.location, assign });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps every sign-out request single-encoded and lands on the mobile login', async () => {
    mockSearch = forcedSignOutUrl('mobile', { error: 'SessionExpired', callbackUrl: '/m' }).split(
      '?'
    )[1];
    render(<SignOutClient />);

    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));

    await waitFor(() => expect(assign).toHaveBeenCalled());
    const logoutUrl = String(fetchMock.mock.calls[0][0]);
    expect(logoutUrl).toBe('/api/auth/oidc/logout-url?callbackUrl=%2Fm%2Flogin');
    expect(logoutUrl).not.toMatch(/%25/);
    expect(mockSignOut).toHaveBeenCalledWith({ redirect: false, callbackUrl: '/m/login' });
    expect(assign).toHaveBeenCalledWith('/m/login?callbackUrl=%2Fm&error=SessionExpired');
  });

  it('keeps the existing callback for an ordinary sign-out', async () => {
    mockSearch = '';
    render(<SignOutClient />);

    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/login'));
    expect(mockSignOut).toHaveBeenCalledWith({ redirect: false, callbackUrl: '/login' });
    expect(screen.getByRole('link', { name: /return to app/i })).toHaveAttribute('href', '/login');
  });
});
