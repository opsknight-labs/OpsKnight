import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import MobileNetworkBanner from '@/components/mobile/MobileNetworkBanner';

const mockRefresh = vi.fn();

vi.mock('next/navigation', () => ({
    useRouter: () => ({ refresh: mockRefresh }),
}));

describe('MobileNetworkBanner', () => {
    const originalOnline = Object.getOwnPropertyDescriptor(navigator, 'onLine');

    beforeEach(() => {
        mockRefresh.mockClear();
    });

    afterEach(() => {
        if (originalOnline) {
            Object.defineProperty(navigator, 'onLine', originalOnline);
        }
    });

    it('shows offline banner when offline', () => {
        Object.defineProperty(navigator, 'onLine', {
            value: false,
            configurable: true,
        });

        render(<MobileNetworkBanner />);

        expect(screen.getByText(/offline/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });

    it('shows slow connection banner when on slow network', () => {
        Object.defineProperty(navigator, 'onLine', {
            value: true,
            configurable: true,
        });
        Object.defineProperty(navigator, 'connection', {
            value: { effectiveType: '2g', addEventListener: vi.fn(), removeEventListener: vi.fn() },
            configurable: true,
        });

        render(<MobileNetworkBanner />);

        expect(screen.getByText(/slow connection/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    });
});
