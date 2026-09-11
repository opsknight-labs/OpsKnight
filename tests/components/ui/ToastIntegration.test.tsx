import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { Toaster } from '@/components/ui/shadcn/sonner';
import { notify } from '@/lib/toast';

describe('Toast and Toaster Component Contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it('renders a success toast with stable id and closes when close button is clicked', async () => {
    render(<Toaster />);

    // Trigger success toast
    notify.success('Service settings saved', { id: 'service:1:save' });

    // Toast title is rendered
    expect(await screen.findByText('Service settings saved')).toBeDefined();

    // Close button affordance exists and has accessible label
    const closeBtn = screen.getByRole('button', { name: /close/i });
    expect(closeBtn).toBeDefined();

    // Clicking close button dismisses the toast
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByText('Service settings saved')).toBeNull();
    });
  });

  it('deduplicates rapid notifications sharing the same id', async () => {
    render(<Toaster />);

    // Fire multiple toasts with the same dedup ID
    notify.success('Service settings saved', { id: 'service:dedup:save' });
    notify.success('Service settings saved', { id: 'service:dedup:save' });

    await screen.findByText('Service settings saved');

    // Only one toast with this text should exist
    const toasts = screen.getAllByText('Service settings saved');
    expect(toasts.length).toBe(1);
  });

  it('renders different toasts for independent actions', async () => {
    render(<Toaster />);

    notify.success('Settings saved', { id: 'settings:1:save' });
    notify.info('Informational notice', { id: 'info:1' });

    expect(await screen.findByText('Settings saved')).toBeDefined();
    expect(await screen.findByText('Informational notice')).toBeDefined();
  });

  it('provides close button with touch-friendly 40x40 dimension classes', async () => {
    render(<Toaster />);

    notify.success('Touch target test', { id: 'touch:1' });
    await screen.findByText('Touch target test');

    const closeBtn = screen.getByRole('button', { name: /close/i });
    expect(closeBtn.className).toContain('!h-10');
    expect(closeBtn.className).toContain('!w-10');
  });

  it('allows programmatic dismiss via notify.dismiss', async () => {
    render(<Toaster />);

    notify.success('Dismiss me', { id: 'dismiss:target' });
    expect(await screen.findByText('Dismiss me')).toBeDefined();

    notify.dismiss('dismiss:target');

    await waitFor(() => {
      expect(screen.queryByText('Dismiss me')).toBeNull();
    });
  });
});
