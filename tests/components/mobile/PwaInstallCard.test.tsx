import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import PwaInstallCard from '@/components/mobile/PwaInstallCard';

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches,
      media: '(display-mode: standalone)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe('PwaInstallCard', () => {
  const originalUserAgent = window.navigator.userAgent;

  beforeEach(() => {
    mockMatchMedia(false);
    Object.defineProperty(window.navigator, 'standalone', {
      configurable: true,
      value: false,
    });
  });

  afterEach(() => {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: originalUserAgent,
    });
  });

  it('renders install instructions for iOS Safari', () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile Safari/605.1.15',
    });

    render(<PwaInstallCard />);

    expect(screen.getByText('Install OpsKnight')).toBeInTheDocument();
    expect(screen.getByText(/Add the app to your Home Screen/i)).toBeInTheDocument();
  });

  it('does not render on non-iOS browsers', () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    render(<PwaInstallCard />);

    expect(screen.queryByText('Install OpsKnight')).toBeNull();
  });
});
