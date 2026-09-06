import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import MobileQuickSwitcher from '@/components/mobile/MobileQuickSwitcher';

const mockFetch = vi.fn();

describe('MobileQuickSwitcher', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('opens the quick switcher overlay', () => {
    render(<MobileQuickSwitcher />);
    fireEvent.click(screen.getByLabelText('Open quick switcher'));
    expect(screen.getByPlaceholderText('Type a command or search...')).toBeInTheDocument();
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
    fireEvent.click(screen.getByLabelText('Open quick switcher'));

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
