import { act, fireEvent, render, screen } from '@testing-library/react';
import { lazy, Suspense, type ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// next/dynamic needs the Next runtime; React.lazy gives the same "loaded on first use" behaviour in jsdom.
vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<{ default: ComponentType<Record<string, unknown>> }>) => {
    const Lazy = lazy(loader);
    return function Dynamic(props: Record<string, unknown>) {
      return (
        <Suspense fallback={null}>
          <Lazy {...props} />
        </Suspense>
      );
    };
  },
}));

import InsightsInspectorHost from '@/components/incident/intelligence/InsightsInspectorHost';
import { INSIGHTS_WIDTH_KEY } from '@/lib/intelligence/incident-ux/strip-contract';
import { KEYBOARD_SHORTCUTS } from '@/lib/keyboard-shortcuts';

let narrow = false;

function Page({ presentation }: { presentation?: 'desktop' | 'mobile' }) {
  return (
    <>
      <a href="?insights=similar" data-insights-open="similar">
        3 similar
      </a>
      <a href="?insights=related" data-insights-open="related">
        View group
      </a>
      <input aria-label="Note" />
      <input type="checkbox" aria-label="Show intelligence events" />
      <InsightsInspectorHost sections={['similar', 'related']} presentation={presentation}>
        <section id="insights-similar" tabIndex={-1} aria-label="Similar past incidents">
          <ul>
            <li id="finding-f1">Checkout pool exhausted last month</li>
          </ul>
        </section>
        <section id="insights-related" tabIndex={-1} aria-label="Related incidents">
          Related content
        </section>
      </InsightsInspectorHost>
    </>
  );
}

beforeEach(() => {
  narrow = false;
  window.localStorage.clear();
  window.history.replaceState(null, '', '/incidents/inc-1');
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('max-width') ? narrow : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  );
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const inspector = () => screen.findByRole('dialog', { name: 'Insights' });

describe('insights inspector', () => {
  it('renders nothing until opened, so server-rendered sections stay out of the page', () => {
    render(<Page />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Related content')).not.toBeInTheDocument();
  });

  it('opens from a strip chip at that section, without navigating, and records a shareable link', async () => {
    render(<Page />);
    const chip = screen.getByRole('link', { name: '3 similar' });
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    act(() => {
      chip.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    const dialog = await inspector();
    expect(dialog).toHaveAttribute('data-layout', 'side-panel');
    expect(window.location.search).toBe('?insights=similar');
    await vi.waitFor(() =>
      expect(document.getElementById('insights-similar')!.scrollIntoView).toHaveBeenCalled()
    );
    expect(screen.getByRole('region', { name: 'Similar past incidents' })).toHaveFocus();
  });

  it('leaves modified clicks to the browser (open in a new tab)', () => {
    render(<Page />);
    const event = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
      metaKey: true,
    });
    act(() => {
      screen.getByRole('link', { name: '3 similar' }).dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('toggles with the I shortcut, which is listed in the shortcut registry', async () => {
    expect(KEYBOARD_SHORTCUTS.find(shortcut => shortcut.id === 'incident-insights')).toMatchObject({
      keys: ['I'],
      category: 'Incident Triage',
      runtimeOwner: 'InsightsInspectorHost',
    });
    render(<Page />);
    fireEvent.keyDown(document.body, { key: 'i' });
    await inspector();
    expect(window.location.search).toBe('?insights=open');
    fireEvent.keyDown(document.body, { key: 'i' });
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(window.location.search).toBe('');
  });

  it('ignores I while typing, with a modifier, and inside the G then I navigation chord', () => {
    render(<Page />);
    fireEvent.keyDown(screen.getByLabelText('Note'), { key: 'i' });
    fireEvent.keyDown(document.body, { key: 'i', metaKey: true });
    fireEvent.keyDown(document.body, { key: 'g' });
    fireEvent.keyDown(document.body, { key: 'i' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('still toggles with I after a checkbox was clicked, since a checkbox takes no typing', async () => {
    render(<Page />);
    const toggle = screen.getByLabelText('Show intelligence events');
    toggle.focus();
    fireEvent.keyDown(toggle, { key: 'i' });
    await inspector();
  });

  it('opens from a ?insights= deep link, and from a #finding- anchor at that item', async () => {
    window.history.replaceState(null, '', '/incidents/inc-1?insights=related');
    const first = render(<Page />);
    await inspector();
    await vi.waitFor(() =>
      expect(document.getElementById('insights-related')!.scrollIntoView).toHaveBeenCalled()
    );
    first.unmount();

    window.history.replaceState(null, '', '/incidents/inc-1#finding-f1');
    render(<Page />);
    await inspector();
    await vi.waitFor(() =>
      expect(document.getElementById('finding-f1')!.scrollIntoView).toHaveBeenCalled()
    );
  });

  it('treats an unknown ?insights= value as "open at the top"', async () => {
    window.history.replaceState(null, '', '/incidents/inc-1?insights=%3Cscript%3E');
    render(<Page />);
    await inspector();
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it('closes on Escape and removes the deep-link parameter', async () => {
    render(<Page />);
    fireEvent.keyDown(document.body, { key: 'i' });
    const dialog = await inspector();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(window.location.search).toBe('');
  });

  it('steps aside when a link jumps into a core tab', async () => {
    render(<Page />);
    fireEvent.keyDown(document.body, { key: 'i' });
    await inspector();
    window.history.replaceState(null, '', '/incidents/inc-1#runbook-suggested');
    act(() => {
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('is resizable from the keyboard on desktop and remembers the width', async () => {
    window.localStorage.setItem(INSIGHTS_WIDTH_KEY, '700');
    Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true });
    render(<Page />);
    fireEvent.keyDown(document.body, { key: 'i' });
    const dialog = await inspector();
    expect(dialog.style.width).toBe('700px');
    const handle = screen.getByRole('separator', { name: 'Resize insights panel' });
    expect(handle).toHaveAttribute('aria-valuenow', '700');
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(window.localStorage.getItem(INSIGHTS_WIDTH_KEY)).toBe('732');
    expect(dialog.style.width).toBe('732px');
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(window.localStorage.getItem(INSIGHTS_WIDTH_KEY)).toBe('700');
  });

  it('has section navigation that scrolls inside the panel', async () => {
    render(<Page />);
    fireEvent.keyDown(document.body, { key: 'i' });
    await inspector();
    const nav = screen.getByRole('navigation', { name: 'Insight sections' });
    fireEvent.click(screen.getByRole('button', { name: 'Related' }));
    expect(nav).toBeInTheDocument();
    expect(document.getElementById('insights-related')!.scrollIntoView).toHaveBeenCalled();
  });

  it('is a modal bottom sheet on a narrow screen, with no resize handle', async () => {
    narrow = true;
    render(<Page />);
    fireEvent.keyDown(document.body, { key: 'i' });
    expect(await inspector()).toHaveAttribute('data-layout', 'bottom-sheet');
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
  });

  it('stays open beside the assistant on desktop, and gives way to it as a bottom sheet', async () => {
    const desktop = render(<Page />);
    fireEvent.keyDown(document.body, { key: 'i' });
    const panel = await inspector();
    expect(panel.className).toContain('z-[35]');
    act(() => {
      window.dispatchEvent(new CustomEvent('squire:open', { detail: {} }));
    });
    expect(screen.getByRole('dialog', { name: 'Insights' })).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'i' });
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    desktop.unmount();

    narrow = true;
    render(<Page />);
    fireEvent.keyDown(document.body, { key: 'i' });
    await inspector();
    act(() => {
      window.dispatchEvent(new CustomEvent('squire:open', { detail: {} }));
    });
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('is a bottom sheet on the mobile route at any width', async () => {
    render(<Page presentation="mobile" />);
    fireEvent.keyDown(document.body, { key: 'i' });
    expect(await inspector()).toHaveAttribute('data-layout', 'bottom-sheet');
  });
});
