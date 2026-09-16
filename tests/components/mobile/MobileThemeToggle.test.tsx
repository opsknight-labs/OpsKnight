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

  // Regression guard for the `System` -> `Syste` / `m` mid-word split bug:
  // labels must render with a nowrap span inside the container-scoped
  // segmented-control layout, never as free-flowing wrappable text.
  it('never allows option labels to become wrappable text', () => {
    vi.mocked(useTheme).mockReturnValue({
      theme: 'system',
      resolvedTheme: 'light',
      systemTheme: 'light',
      themes: ['light', 'dark', 'system'],
      setTheme: vi.fn(),
    });
    render(<MobileThemeToggle />);

    for (const label of ['Light', 'System', 'Dark']) {
      const option = screen.getByRole('radio', { name: label });
      expect(option.className).toContain('mobile-segmented-option');
      const labelSpan = option.querySelector('span');
      expect(labelSpan?.className).toContain('whitespace-nowrap');
      expect(labelSpan?.textContent).toBe(label);
    }
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
