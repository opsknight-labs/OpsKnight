import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import MobileQuickSwitcher from '@/components/mobile/MobileQuickSwitcher';

const mockFetch = vi.fn();

type MockVisualViewport = {
  height: number;
  offsetTop: number;
  addEventListener: (type: string, cb: () => void) => void;
  removeEventListener: (type: string, cb: () => void) => void;
};

function mockVisualViewport(height: number, offsetTop = 0): MockVisualViewport {
  const listeners: Record<string, Array<() => void>> = {};
  const viewport: MockVisualViewport = {
    height,
    offsetTop,
    addEventListener: (type, cb) => {
      (listeners[type] ||= []).push(cb);
    },
    removeEventListener: (type, cb) => {
      listeners[type] = (listeners[type] || []).filter(l => l !== cb);
    },
  };
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
  return viewport;
}

describe('MobileQuickSwitcher', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(window, 'visualViewport');
  });

  it('opens the quick switcher overlay', () => {
    render(<MobileQuickSwitcher />);
    fireEvent.click(screen.getByLabelText('Search OpsKnight'));
    expect(screen.getByPlaceholderText('Search incidents, services, teams…')).toBeInTheDocument();
  });

  // Regression guard: an earlier version floored the sheet height at 280px,
  // which could exceed a visual viewport shrunk by the on-screen keyboard
  // (e.g. 240px), pushing content behind the keyboard.
  it('never lets the sheet height exceed the visible viewport when the keyboard opens', () => {
    mockVisualViewport(240);
    render(<MobileQuickSwitcher />);
    fireEvent.click(screen.getByLabelText('Search OpsKnight'));

    const sheet = screen.getByRole('dialog');
    const maxHeight = parseInt(sheet.style.maxHeight, 10);
    expect(maxHeight).toBeLessThanOrEqual(240);
  });

  it('lifts the sheet above the keyboard using the visual viewport offset', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    mockVisualViewport(500, 0);
    render(<MobileQuickSwitcher />);
    fireEvent.click(screen.getByLabelText('Search OpsKnight'));

    const sheet = screen.getByRole('dialog');
    expect(sheet.style.bottom).toBe('300px');
  });

  it('returns focus to the search trigger when the sheet closes', () => {
    render(<MobileQuickSwitcher />);
    const trigger = screen.getByLabelText('Search OpsKnight');
    fireEvent.click(trigger);
    fireEvent.click(screen.getByLabelText('Close search'));
    expect(trigger).toHaveFocus();
  });

  it('renders a real 44x44 close control and a 48px/16px input', () => {
    render(<MobileQuickSwitcher />);
    fireEvent.click(screen.getByLabelText('Search OpsKnight'));

    const close = screen.getByLabelText('Close search');
    expect(close.className).toContain('h-11');
    expect(close.className).toContain('w-11');

    const input = screen.getByRole('combobox');
    expect(input.className).toContain('h-12');
    expect(input.className).toContain('text-base');
  });

  it('fetches and renders search results', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            type: 'incident',
            id: 'inc-1',
            title: 'API Down',
            subtitle: 'Payments - OPEN',
            priority: 1,
          },
        ],
      }),
    });

    render(<MobileQuickSwitcher />);
    fireEvent.click(screen.getByLabelText('Search OpsKnight'));

    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'ap' } });

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 300));
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/search?q=ap'),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(await screen.findByText('API Down')).toBeInTheDocument();
  });
});
