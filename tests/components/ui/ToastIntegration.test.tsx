import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import { ThemeProvider } from 'next-themes';
import { Toaster } from '@/components/ui/shadcn/sonner';
import { notify } from '@/lib/toast';

function mockMatchMedia(prefersDark: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: prefersDark && query.includes('prefers-color-scheme: dark'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function toasterTheme() {
  return document.querySelector('[data-sonner-toaster]')?.getAttribute('data-sonner-theme');
}

describe('Toast and Toaster Component Contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    act(() => notify.dismiss());
    document.body.innerHTML = '';
    localStorage.clear();
    mockMatchMedia(false);
  });

  it('renders a success toast with stable id and closes when close button is clicked', async () => {
    render(<Toaster />);

    act(() => {
      notify.success('Service settings saved', { id: 'service:1:save' });
    });

    expect(await screen.findByText('Service settings saved')).toBeDefined();

    const closeBtn = screen.getByRole('button', { name: 'Close notification' });
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByText('Service settings saved')).toBeNull();
    });
  });

  it('deduplicates rapid notifications sharing the same id', async () => {
    render(<Toaster />);

    act(() => {
      notify.success('Service settings saved', { id: 'service:dedup:save' });
      notify.success('Service settings saved', { id: 'service:dedup:save' });
    });

    await screen.findByText('Service settings saved');
    expect(screen.getAllByText('Service settings saved')).toHaveLength(1);
  });

  it('renders different toasts for independent actions', async () => {
    render(<Toaster />);

    act(() => {
      notify.success('Settings saved', { id: 'settings:1:save' });
      notify.info('Informational notice', { id: 'info:1' });
    });

    expect(await screen.findByText('Settings saved')).toBeDefined();
    expect(await screen.findByText('Informational notice')).toBeDefined();
  });

  it('renders title, description and a tone-specific icon for each notification', async () => {
    render(<Toaster />);

    act(() => {
      notify.warning('Rate limit approaching', {
        id: 'warn:1',
        description: '80% of the hourly quota used.',
      });
    });

    const title = await screen.findByTestId('toast-title');
    expect(title.textContent).toBe('Rate limit approaching');
    expect(screen.getByTestId('toast-description').textContent).toBe(
      '80% of the hourly quota used.'
    );
    expect(title.closest('[data-tone]')?.getAttribute('data-tone')).toBe('warning');
    expect(screen.getByTestId('toast-icon').querySelector('svg')).not.toBeNull();
  });

  it('renders errors as an error-toned toast with the error surface class', async () => {
    render(<Toaster />);

    act(() => {
      notify.error(new Error('Could not save schedule.'), { id: 'error:1' });
    });

    const title = await screen.findByTestId('toast-title');
    const toast = title.closest('[data-sonner-toast]');
    expect(title.closest('[data-tone]')?.getAttribute('data-tone')).toBe('error');
    expect(toast?.className).toContain('ok-toast-item--error');
  });

  it('runs the action callback and dismisses the toast', async () => {
    render(<Toaster />);
    const onUndo = vi.fn();

    act(() => {
      notify.info('Incident archived', {
        id: 'undo:1',
        action: { label: 'Undo', onClick: onUndo },
      });
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));

    expect(onUndo).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByText('Incident archived')).toBeNull();
    });
  });

  it('replaces a loading toast in place when the result reuses its id', async () => {
    render(<Toaster />);

    act(() => {
      notify.loading('Saving changes…', { id: 'save:1' });
    });
    const loadingTitle = await screen.findByText('Saving changes…');
    expect(loadingTitle.closest('[data-tone]')?.getAttribute('data-tone')).toBe('loading');

    act(() => {
      notify.success('Changes saved', { id: 'save:1' });
    });

    const doneTitle = await screen.findByText('Changes saved');
    expect(doneTitle.closest('[data-tone]')?.getAttribute('data-tone')).toBe('success');
    expect(screen.queryByText('Saving changes…')).toBeNull();
    expect(document.querySelectorAll('[data-sonner-toast]')).toHaveLength(1);
  });

  it('allows programmatic dismiss via notify.dismiss', async () => {
    render(<Toaster />);

    act(() => {
      notify.success('Dismiss me', { id: 'dismiss:target' });
    });
    expect(await screen.findByText('Dismiss me')).toBeDefined();

    act(() => notify.dismiss('dismiss:target'));

    await waitFor(() => {
      expect(screen.queryByText('Dismiss me')).toBeNull();
    });
  });

  it('keeps an explicit theme override on the toaster', async () => {
    render(<Toaster theme="dark" />);

    act(() => {
      notify.info('Dark mode toast', { id: 'dark:1' });
    });
    await screen.findByText('Dark mode toast');

    expect(toasterTheme()).toBe('dark');
  });

  describe('theme follows the painted page, not the OS or stored preference', () => {
    it('stays light on the forced-light desktop when the OS and stored preference are dark', async () => {
      // The reported bug: browser dark mode plus a stored mobile preference
      // rendered dark toasts with an invisible close button on a light page.
      mockMatchMedia(true);
      localStorage.setItem('theme', 'system');

      render(
        <ThemeProvider
          attribute="class"
          forcedTheme="light"
          defaultTheme="light"
          enableSystem={false}
        >
          <Toaster />
        </ThemeProvider>
      );

      act(() => {
        notify.success('Saved', { id: 'forced:1' });
      });
      await screen.findByText('Saved');

      expect(toasterTheme()).toBe('light');
    });

    it('stays light on the forced-light desktop when dark is stored explicitly', async () => {
      localStorage.setItem('theme', 'dark');

      render(
        <ThemeProvider
          attribute="class"
          forcedTheme="light"
          defaultTheme="light"
          enableSystem={false}
        >
          <Toaster />
        </ThemeProvider>
      );

      act(() => {
        notify.success('Saved', { id: 'forced:2' });
      });
      await screen.findByText('Saved');

      expect(toasterTheme()).toBe('light');
    });

    it('follows the OS on system-themed (mobile) routes', async () => {
      mockMatchMedia(true);

      render(
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <Toaster />
        </ThemeProvider>
      );

      act(() => {
        notify.success('Saved', { id: 'system:1' });
      });
      await screen.findByText('Saved');

      await waitFor(() => expect(toasterTheme()).toBe('dark'));
    });
  });
});
