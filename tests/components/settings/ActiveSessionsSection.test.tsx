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
  it('renders registered sessions from the API without fallback dependency', async () => {
    const mockSessions = [
      {
        id: 'session-jti-1',
        displayId: '81A7F2C9',
        policy: 'STANDARD' as const,
        state: 'ACTIVE' as const,
        browser: 'Google Chrome',
        os: 'macOS',
        deviceType: 'desktop' as const,
        createdAt: new Date().toISOString(),
        lastActive: new Date().toISOString(),
        expiresAt: null,
        isCurrent: true,
      },
      {
        id: 'session-jti-2',
        displayId: '9B2C3D4E',
        policy: 'STANDARD' as const,
        state: 'ACTIVE' as const,
        browser: 'Microsoft Edge',
        os: 'Windows',
        deviceType: 'desktop' as const,
        createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        lastActive: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        expiresAt: null,
        isCurrent: false,
      },
    ];

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          sessions: mockSessions,
          nextCursor: null,
          hasMore: false,
        }),
      }) as unknown as typeof fetch
    );

    render(<ActiveSessionsSection tokenVersion={1} />);

    expect(await screen.findByText('Google Chrome on macOS')).toBeInTheDocument();
    expect(screen.getByText('Microsoft Edge on Windows')).toBeInTheDocument();
    expect(screen.getByText('This session')).toBeInTheDocument();
    expect(screen.getByText(/81A7F2C9/)).toBeInTheDocument();
    expect(screen.getByText(/not individual revocation handles/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Revoke all sessions/i })).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it('renders explicit error alert and retry button when sessions API fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ error: 'Service Unavailable' }),
      }) as unknown as typeof fetch
    );

    render(<ActiveSessionsSection tokenVersion={1} />);

    expect(await screen.findByText('Service Unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();

    vi.unstubAllGlobals();
  });
});
