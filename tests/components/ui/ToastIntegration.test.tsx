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

  it('provides a 28x28 visual close button with expanded touch target', async () => {
    render(<Toaster />);

    notify.success('Touch target test', { id: 'touch:1' });
    await screen.findByText('Touch target test');

    const closeBtn = screen.getByRole('button', { name: /close/i });
    expect(closeBtn.className).toContain('!h-7');
    expect(closeBtn.className).toContain('!w-7');
    expect(closeBtn.className).toContain('after:-inset-1.5');
  });

  it('renders semantic icon badge and neutral card surface with status rail', async () => {
    render(<Toaster />);

    notify.success('Card styling test', { id: 'style:1' });
    const toastTitle = await screen.findByText('Card styling test');

    // Semantic icon badge container is rendered
    const badge = screen.getByTestId('toast-icon-badge');
    expect(badge).toBeDefined();
    expect(badge.className).toContain('h-7');
    expect(badge.className).toContain('w-7');

    // Toast container contains neutral surface and status rail classes
    const toastCard = toastTitle.closest('li');
    expect(toastCard).toBeDefined();
    expect(toastCard?.className).toContain('data-[styled=true]:!bg-[var(--toast-bg)]');
    expect(toastCard?.className).toContain('before:!bg-[var(--toast-success-accent)]');
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

  it('renders a visible cross icon inside the close button with high-contrast stroke', async () => {
    render(<Toaster />);

    notify.success('Visible cross test', { id: 'cross:1' });
    await screen.findByText('Visible cross test');

    const closeBtn = screen.getByRole('button', { name: /close/i });
    expect(closeBtn).toBeDefined();

    const closeIcon = screen.getByTestId('toast-close-icon');
    expect(closeIcon).toBeDefined();
    expect(closeIcon.getAttribute('class')).toContain('stroke-[2.25]');
    expect(closeBtn.contains(closeIcon)).toBe(true);
  });

  it('supports dark mode theme configuration on the toaster', async () => {
    render(<Toaster theme="dark" />);

    notify.info('Dark mode toast', { id: 'dark:1' });
    await screen.findByText('Dark mode toast');

    const toaster = document.querySelector('[data-sonner-toaster]');
    expect(toaster).toBeDefined();
    expect(toaster?.getAttribute('data-sonner-theme')).toBe('dark');
  });
});

