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
  it('renders current and recently observed device activity without implying per-device revocation', () => {
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

    expect(screen.getByText('Google Chrome on macOS')).toBeInTheDocument();
    expect(screen.getByText('Microsoft Edge on Windows')).toBeInTheDocument();

    expect(screen.getByText('This Device')).toBeInTheDocument();
    expect(screen.getByText('Recent Device')).toBeInTheDocument();
    expect(screen.getByText('Active 10m ago')).toBeInTheDocument();
    expect(
      screen.getByText(/not individual revocation handles/i)
    ).toBeInTheDocument();

    expect(screen.getByRole('button', { name: /Revoke All Sessions/i })).toBeInTheDocument();
  });
});
