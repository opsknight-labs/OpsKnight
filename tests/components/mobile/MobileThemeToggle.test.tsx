import { render, screen, fireEvent } from '@testing-library/react';
import MobileThemeToggle from '@/components/mobile/MobileThemeToggle';
import { useTheme } from 'next-themes';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock next-themes
vi.mock('next-themes', () => ({
  useTheme: vi.fn(),
}));

describe('MobileThemeToggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders correctly', () => {
    vi.mocked(useTheme).mockReturnValue({
      theme: 'light',
      resolvedTheme: 'light',
      systemTheme: 'light',
      themes: ['light', 'dark', 'system'],
      setTheme: vi.fn(),
    });
    render(<MobileThemeToggle />);
    expect(screen.getByRole('radio', { name: 'Light' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'System' })).toBeInTheDocument();
  });

  it('toggles from light to dark', () => {
    const setTheme = vi.fn();
    vi.mocked(useTheme).mockReturnValue({
      theme: 'light',
      resolvedTheme: 'light',
      systemTheme: 'light',
      themes: ['light', 'dark', 'system'],
      setTheme,
    });

    render(<MobileThemeToggle />);

    const darkBtn = screen.getByRole('radio', { name: 'Dark' });
    fireEvent.click(darkBtn);

    expect(setTheme).toHaveBeenCalledWith('dark');
  });

  it('toggles from dark to light', () => {
    const setTheme = vi.fn();
    vi.mocked(useTheme).mockReturnValue({
      theme: 'dark',
      resolvedTheme: 'dark',
      systemTheme: 'dark',
      themes: ['light', 'dark', 'system'],
      setTheme,
    });

    render(<MobileThemeToggle />);

    const lightBtn = screen.getByRole('radio', { name: 'Light' });
    fireEvent.click(lightBtn);

    expect(setTheme).toHaveBeenCalledWith('light');
  });
});
