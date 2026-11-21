import { createRef } from 'react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SidebarSearch from '@/components/SidebarSearch';
import CommandPalette from '@/components/command-palette/CommandPalette';
import { RECENTS_KEY } from '@/components/command-palette/palette-model';

const push = vi.fn();
const openCreateIncident = vi.fn();
const setChoice = vi.fn();

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/contexts/IncidentCreationModalContext', () => ({
  useCreateIncidentModal: () => ({ openCreateIncident }),
}));
vi.mock('@/hooks/use-theme-preference', () => ({
  useThemePreference: () => ({ choice: 'dark', locked: false, setChoice }),
}));

function renderPalette() {
  const trigger = createRef<HTMLElement>();
  const onOpenChange = vi.fn();
  render(<CommandPalette open onOpenChange={onOpenChange} returnFocusTo={trigger} modKey="⌘" />);
  return { onOpenChange, input: screen.getByPlaceholderText('Search or type a command…') };
}

describe('SidebarSearch trigger', () => {
  it('is a named button that opens the palette with ⌘K', async () => {
    render(<SidebarSearch />);
    const trigger = screen.getByRole('button', { name: /search or jump to/i });
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');

    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeDefined();
  });
});

describe('CommandPalette', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [] }) });
  });

  it('shows recents, actions and navigation instantly when empty, with no network', () => {
    localStorage.setItem(
      RECENTS_KEY,
      JSON.stringify([{ type: 'service', id: 's1', title: 'Payments API', href: '/services/s1' }])
    );
    renderPalette();
    expect(screen.getByText('Recent')).toBeDefined();
    expect(screen.getByText('Payments API')).toBeDefined();
    expect(screen.getByText('Create incident')).toBeDefined();
    expect(screen.getByText('Dashboard')).toBeDefined();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('filters static commands as you type and shows go-to shortcut hints', () => {
    const { input } = renderPalette();
    fireEvent.change(input, { target: { value: 'users' } });
    expect(screen.getByText('User directory & access roles')).toBeDefined();
    expect(screen.queryByText('Dashboard')).toBeNull();
    expect(screen.getByText('U')).toBeDefined();
  });

  it('groups API results by type and records opened entities as recents', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            type: 'policy',
            id: 'pol-1',
            title: 'Critical Infra Escalation',
            href: '/policies/pol-1',
          },
          { type: 'runbook', id: 'rb-1', title: 'Restart database', href: '/runbooks/rb-1' },
        ],
      }),
    });
    const { input } = renderPalette();
    fireEvent.change(input, { target: { value: 'restart' } });

    expect(await screen.findByText('Restart database')).toBeDefined();
    expect(screen.getByText('Runbooks')).toBeDefined();
    expect(screen.getByText('Escalation policies')).toBeDefined();

    fireEvent.click(screen.getByText('Restart database'));
    expect(push).toHaveBeenCalledWith('/runbooks/rb-1');
    expect(JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]')[0].id).toBe('rb-1');
  });

  it('shows a no-results state with suggestions', async () => {
    const { input } = renderPalette();
    fireEvent.change(input, { target: { value: 'qqqzzz' } });
    expect(await screen.findByText(/No results for/)).toBeDefined();
    expect(screen.getByText('Suggestions')).toBeDefined();
  });

  it('runs actions: create incident opens the modal, theme commands switch theme', () => {
    const { input, onOpenChange } = renderPalette();
    fireEvent.click(screen.getByText('Create incident'));
    expect(openCreateIncident).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);

    fireEvent.change(input, { target: { value: 'light' } });
    fireEvent.click(screen.getByText('Switch to light theme'));
    expect(setChoice).toHaveBeenCalledWith('light');
  });

  it('opens the highlighted link in a new tab on ⌘Enter', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { input } = renderPalette();
    fireEvent.change(input, { target: { value: 'services' } });
    fireEvent.keyDown(input, { key: 'Enter', metaKey: true });
    expect(open).toHaveBeenCalledWith('/services', '_blank', 'noopener');
    expect(push).not.toHaveBeenCalled();
  });

  describe('assistant entry', () => {
    const named = (name: string) => {
      document.documentElement.dataset.squireName = name;
      window.dispatchEvent(new Event('squire:ready'));
    };
    const listen = () => {
      const opened = vi.fn();
      window.addEventListener('squire:open', opened);
      return opened;
    };

    afterEach(() => {
      delete document.documentElement.dataset.squireName;
    });

    it('is absent while the assistant is switched off', () => {
      const { input } = renderPalette();
      fireEvent.change(input, { target: { value: 'ask' } });
      expect(screen.queryByText(/^Ask /)).toBeNull();
    });

    it('appears with the configured name and opens the assistant empty when only the name is typed', async () => {
      named('Pip');
      const opened = listen();
      const { input, onOpenChange } = renderPalette();
      fireEvent.change(input, { target: { value: 'pip' } });
      fireEvent.click(await screen.findByText('Ask Pip'));
      expect(opened).toHaveBeenCalledTimes(1);
      expect((opened.mock.calls[0][0] as CustomEvent).detail).toEqual({});
      expect(onOpenChange).toHaveBeenCalledWith(false);
      window.removeEventListener('squire:open', opened);
    });

    it('hands the typed question to the assistant so it is asked without retyping', async () => {
      named('Pip');
      const opened = listen();
      const { input } = renderPalette();
      fireEvent.change(input, { target: { value: 'ask pip why is checkout failing?' } });
      const entry = await screen.findByText('Ask Pip');
      expect(screen.getByText('why is checkout failing?')).toBeInTheDocument();
      fireEvent.click(entry);
      expect((opened.mock.calls[0][0] as CustomEvent).detail).toEqual({
        message: 'why is checkout failing?',
      });
      window.removeEventListener('squire:open', opened);
    });

    it('offers the assistant for a plain question that does not name it', async () => {
      named('Pip');
      const opened = listen();
      const { input } = renderPalette();
      fireEvent.change(input, { target: { value: 'who is on call for checkout?' } });
      fireEvent.click(await screen.findByText('Ask Pip'));
      expect((opened.mock.calls[0][0] as CustomEvent).detail).toEqual({
        message: 'who is on call for checkout?',
      });
      window.removeEventListener('squire:open', opened);
    });
  });
});
