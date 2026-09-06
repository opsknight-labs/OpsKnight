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
  it('renders multiple active sessions properly with This Device and Connected Device badges', () => {
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

    // Both sessions should be rendered
    expect(screen.getByText('Google Chrome on macOS')).toBeInTheDocument();
    expect(screen.getByText('Microsoft Edge on Windows')).toBeInTheDocument();

    // Badges
    expect(screen.getByText('This Device')).toBeInTheDocument();
    expect(screen.getByText('Connected Device')).toBeInTheDocument();

    // Edge session relative time
    expect(screen.getByText('Active 10m ago')).toBeInTheDocument();

    // Revoke button
    expect(screen.getByRole('button', { name: /Revoke All Sessions/i })).toBeInTheDocument();
  });
});
