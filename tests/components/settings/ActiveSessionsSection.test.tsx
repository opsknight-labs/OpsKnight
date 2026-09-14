import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ActiveSessionsSection from '@/components/settings/ActiveSessionsSection';

vi.mock('next-auth/react', () => ({
  signOut: vi.fn(),
}));

vi.mock('@/app/(app)/settings/security/actions', () => ({
  revokeAllSessions: vi.fn().mockResolvedValue({ success: true }),
}));

describe('ActiveSessionsSection', () => {
  it('renders current and recently observed device activity without implying per-device revocation', async () => {
    // Keep the registered-sessions fetch pending so the prop-driven fallback stays visible for assertions.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})) as unknown as typeof fetch);

    const mockSessions = [
      {
        id: 'sess-1',
        browser: 'Google Chrome',
        os: 'macOS',
        deviceType: 'desktop' as const,
        ip: '192.168.1.5',
        isCurrent: true,
        lastActive: new Date().toISOString(),
        tokenVersion: 1,
      },
      {
        id: 'sess-2',
        browser: 'Microsoft Edge',
        os: 'Windows',
        deviceType: 'desktop' as const,
        ip: '192.168.1.20',
        isCurrent: false,
        lastActive: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        tokenVersion: 1,
      },
    ];

    render(<ActiveSessionsSection tokenVersion={1} sessions={mockSessions} />);

    // Fallback sessions render immediately before the registered sessions fetch resolves.
    expect(screen.getByText('Google Chrome on macOS')).toBeInTheDocument();
    expect(screen.getByText('Microsoft Edge on Windows')).toBeInTheDocument();
    // "This device" appears both as a badge and inside the "Sign out this device" button label.
    expect(screen.getAllByText(/This device/i).length).toBeGreaterThan(0);
    expect(
      screen.getByText(/not individual revocation handles/i)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Revoke all sessions/i })).toBeInTheDocument();

    vi.unstubAllGlobals();
  });
});
