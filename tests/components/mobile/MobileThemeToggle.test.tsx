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
            themes: ['light', 'dark'],
            setTheme: vi.fn(),
        });
        render(<MobileThemeToggle />);
        expect(screen.getAllByText('Light Mode').length).toBeGreaterThan(0);
    });

    it('toggles from light to dark', () => {
        const setTheme = vi.fn();
        vi.mocked(useTheme).mockReturnValue({
            theme: 'light',
            resolvedTheme: 'light',
            systemTheme: 'light',
            themes: ['light', 'dark'],
            setTheme,
        });

        render(<MobileThemeToggle />);

        const label = screen.getByText('Light Mode');
        fireEvent.click(label);

        expect(setTheme).toHaveBeenCalledWith('dark');
    });

    it('toggles from dark to light', () => {
        const setTheme = vi.fn();
        vi.mocked(useTheme).mockReturnValue({
            theme: 'dark',
            resolvedTheme: 'dark',
            systemTheme: 'dark',
            themes: ['light', 'dark'],
            setTheme,
        });

        render(<MobileThemeToggle />);

        const label = screen.getByText('Dark Mode');
        fireEvent.click(label);

        expect(setTheme).toHaveBeenCalledWith('light');
    });
});
