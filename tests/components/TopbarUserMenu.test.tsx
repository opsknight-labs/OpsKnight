import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TopbarUserMenu from '@/components/TopbarUserMenu';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

// Mock hooks
vi.mock('@/hooks/useUserAvatar', () => ({
  useUserAvatarSafe: () => 'https://example.com/avatar.png',
}));

describe('TopbarUserMenu', () => {
  it('renders avatar trigger and opens menu with user info and navigation options', () => {
    render(
      <TopbarUserMenu
        name="Alex Mercer"
        email="alex@opsknight.io"
        role="ADMIN"
        avatarUrl={null}
        gender={null}
        userId="user-123"
        legalNotice={<span>AGPL-3.0-only</span>}
      />
    );

    // Find trigger button
    const trigger = screen.getByRole('button');
    expect(trigger).toBeInTheDocument();

    // Click to open dropdown (Radix DropdownMenu uses pointerDown)
    fireEvent.pointerDown(trigger, { button: 0 });

    // Header info
    expect(screen.getByText('Alex Mercer')).toBeInTheDocument();
    expect(screen.getByText('alex@opsknight.io')).toBeInTheDocument();
    expect(screen.getByText('ADMIN')).toBeInTheDocument();

    // Menu options
    expect(screen.getByText('My Profile')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument();
    expect(screen.getByText('Help & Documentation')).toBeInTheDocument();
    expect(screen.getByText('Sign Out')).toBeInTheDocument();

    // Legal notice in footer
    expect(screen.getByText('AGPL-3.0-only')).toBeInTheDocument();
  });
});
