import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PasswordStrength from '@/components/settings/PasswordStrength';
import SecurityForm from '@/components/settings/SecurityForm';
import ActiveSessionsSection from '@/components/settings/ActiveSessionsSection';
import SecurityRecentActivity from '@/components/settings/SecurityRecentActivity';

// Mock react-dom useFormStatus
vi.mock('react-dom', () => ({
  useFormStatus: () => ({ pending: false }),
}));

// Mock next-auth/react
vi.mock('next-auth/react', () => ({
  signOut: vi.fn(),
  useSession: () => ({ data: null }),
}));

// Mock server actions
vi.mock('@/app/(app)/settings/actions', () => ({
  updatePassword: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('@/app/(app)/settings/security/actions', () => ({
  revokeAllSessions: vi.fn().mockResolvedValue({ success: true }),
}));

describe('Security Components', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('PasswordStrength', () => {
    it('renders password strength meter and requirements checklist', () => {
      render(<PasswordStrength password="Password123!" />);

      expect(screen.getByText('Password Strength')).toBeInTheDocument();
      expect(screen.getByText('At least 8 characters')).toBeInTheDocument();
      expect(screen.getByText('Contains lowercase letter (a-z)')).toBeInTheDocument();
      expect(screen.getByText('Contains uppercase letter (A-Z)')).toBeInTheDocument();
      expect(screen.getByText('Contains number (0-9)')).toBeInTheDocument();
      expect(screen.getByText('Contains special character (!@#$...)')).toBeInTheDocument();
    });

    it('returns null when password is empty', () => {
      const { container } = render(<PasswordStrength password="" />);
      expect(container.firstChild).toBeNull();
    });
  });

  describe('SecurityForm', () => {
    it('renders password fields with visibility toggles', () => {
      render(<SecurityForm hasPassword={true} />);

      expect(screen.getByPlaceholderText('Enter current password')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Enter new strong password')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Re-enter new password')).toBeInTheDocument();

      const toggleButtons = screen.getAllByRole('button', { name: /password/i });
      expect(toggleButtons.length).toBeGreaterThan(0);
    });

    it('renders Create Password when hasPassword is false', () => {
      render(<SecurityForm hasPassword={false} />);

      expect(screen.queryByPlaceholderText('Enter current password')).not.toBeInTheDocument();
      expect(screen.getByPlaceholderText('Enter new strong password')).toBeInTheDocument();
    });

    it('toggles password visibility when eye button is clicked', () => {
      render(<SecurityForm hasPassword={true} />);

      const currentPasswordInput = screen.getByPlaceholderText('Enter current password');
      expect(currentPasswordInput).toHaveAttribute('type', 'password');

      const showButton = screen.getByLabelText('Show current password');
      fireEvent.click(showButton);

      expect(currentPasswordInput).toHaveAttribute('type', 'text');
    });
  });

  describe('ActiveSessionsSection', () => {
    it('renders active session information and revocation action', () => {
      render(<ActiveSessionsSection tokenVersion={2} />);

      expect(screen.getByText(/Current authenticated session/i)).toBeInTheDocument();
      expect(screen.getByText(/This Device/i)).toBeInTheDocument();
      expect(screen.getByText(/Active Now/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Revoke All Sessions/i })).toBeInTheDocument();
    });
  });

  describe('SecurityRecentActivity', () => {
    it('renders security audit events correctly', () => {
      const mockEvents = [
        {
          id: 'log-1',
          action: 'user.password.updated',
          timestamp: '2026-09-01T12:00:00.000Z',
          details: { method: 'settings' },
        },
        {
          id: 'log-2',
          action: 'session.revoked_all',
          timestamp: '2026-09-01T11:00:00.000Z',
          details: { reason: 'User initiated' },
        },
      ];

      render(<SecurityRecentActivity events={mockEvents} userEmail="user@example.com" />);

      expect(screen.getByText('Password Changed')).toBeInTheDocument();
      expect(screen.getByText('Sessions Revoked')).toBeInTheDocument();
      expect(screen.getByText(/View Complete Audit Log/i)).toBeInTheDocument();
    });

    it('renders empty state when no security events exist', () => {
      render(<SecurityRecentActivity events={[]} userEmail="user@example.com" />);

      expect(screen.getByText('No recent security alerts')).toBeInTheDocument();
    });
  });
});
