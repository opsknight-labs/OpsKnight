import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import MobileMoreContent from '@/components/mobile/MobileMoreContent';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/m/more',
}));

vi.mock('@/components/mobile/MobileThemeToggle', () => ({
  default: () => <div data-testid="theme-toggle" />,
}));

vi.mock('@/components/mobile/PushNotificationToggle', () => ({
  default: () => <div data-testid="push-toggle" />,
}));

vi.mock('@/components/mobile/PwaInstallCard', () => ({
  default: () => <div data-testid="pwa-install" />,
}));

vi.mock('@/components/mobile/MobileSignOutButton', () => ({
  default: () => <button>Sign Out</button>,
}));

describe('MobileMoreContent', () => {
  it('renders user details in the hero', () => {
    render(<MobileMoreContent name="Ada Lovelace" email="ada@ops.test" role="Admin" />);

    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('ada@ops.test')).toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();
  });

  it('renders shortcut tiles', () => {
    render(<MobileMoreContent name="User" email="" role="User" />);

    expect(screen.getByRole('link', { name: /Teams/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Users/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Schedules/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Policies/i })).toBeInTheDocument();
  });

  it('renders preference toggles', () => {
    render(<MobileMoreContent name="User" email="" role="User" />);

    expect(screen.getByTestId('theme-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('push-toggle')).toBeInTheDocument();
  });

  it('renders account actions', () => {
    render(<MobileMoreContent name="User" email="" role="User" />);

    expect(screen.getByRole('link', { name: /Settings/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Help & Documentation/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sign Out/i })).toBeInTheDocument();
  });
});
