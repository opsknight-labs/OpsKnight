import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ pathname: '/', refresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ refresh: nav.refresh }),
}));
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import SquireLauncher from '@/components/squire/SquireLauncher';
import { openSquire } from '@/components/squire/squire-bus';
import { DISPLAY_KEY, DOCK_CLASS, DOCK_WIDTH, DOCK_WIDTH_VARIABLE } from '@/components/squire/dock';

function streamOf(events: unknown[]) {
  const encoder = new TextEncoder();
  const chunks = events.map(event => encoder.encode(`${JSON.stringify(event)}\n`));
  let index = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () =>
          index < chunks.length
            ? { done: false, value: chunks[index++] }
            : { done: true, value: undefined },
      }),
    },
  };
}

const briefingFor = (incidentId: string) => ({
  incidentId,
  similar: [
    {
      findingId: 'f_sim',
      incidentId: 'inc_old',
      title: 'Checkout latency last month',
      status: 'RESOLVED',
      matchPercent: 82,
    },
  ],
  changes: [
    {
      findingId: 'f_chg',
      changeId: 'chg_1',
      summary: 'Deploy api v9',
      kind: 'DEPLOY',
      leadMinutes: 12,
    },
  ],
  runbooks: [
    { findingId: 'f_rb', runbookId: 'rb_1', name: 'Restart checkout', succeeded: 3, eligible: 4 },
  ],
});

const fetchMock = vi.fn();
let desktop = true;
const html = () => document.documentElement;

beforeEach(() => {
  nav.pathname = '/';
  desktop = true;
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: desktop && query.includes('min-width: 1024px'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  );
  window.localStorage.clear();
  window.history.replaceState({}, '', '/');
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const presentation = (container: HTMLElement) =>
  container.querySelector('[data-presentation]')!.getAttribute('data-presentation');

describe('docked display', () => {
  it('docks beside the page when an incident surface hands over that incident, and frees the space on close', async () => {
    nav.pathname = '/incidents/inc_1';
    const { container } = render(<SquireLauncher name="Pip" />);
    expect(html().style.getPropertyValue(DOCK_WIDTH_VARIABLE)).toBe('');
    act(() => openSquire({ question: 'Why is this the cause?', incidentId: 'inc_1' }));
    const dialog = await screen.findByRole('dialog', { name: /Pip/ });
    await waitFor(() => expect(presentation(container)).toBe('docked'));
    // The shell pads its content row by this variable, so the page reflows instead of being covered.
    expect(html().style.getPropertyValue(DOCK_WIDTH_VARIABLE)).toBe(DOCK_WIDTH);
    expect(html()).toHaveClass(DOCK_CLASS);
    expect(dialog).not.toHaveAttribute('aria-modal');
    // Docked has one fixed place: the floating-only controls step aside.
    expect(screen.queryByRole('button', { name: 'Expand chat' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Move Pip to the/ })).not.toBeInTheDocument();
    // A hand-off default is not a stored preference.
    expect(window.localStorage.getItem(DISPLAY_KEY)).toBeNull();

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(html().style.getPropertyValue(DOCK_WIDTH_VARIABLE)).toBe('');
    expect(html()).not.toHaveClass(DOCK_CLASS);
    expect(screen.getByRole('button', { name: /Ask Pip/ })).toHaveFocus();
  });

  it('floats when opened from the launcher, from another page, or for a different incident', async () => {
    nav.pathname = '/incidents/inc_1';
    const { container } = render(<SquireLauncher name="Pip" />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
    expect(presentation(container)).toBe('panel');
    act(() => openSquire({ question: 'About another incident', incidentId: 'inc_2' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Message Pip')).toHaveValue('About another incident')
    );
    expect(presentation(container)).toBe('panel');
    expect(html().style.getPropertyValue(DOCK_WIDTH_VARIABLE)).toBe('');
    expect(screen.getByRole('button', { name: 'Expand chat' })).toBeInTheDocument();
  });

  it('remembers an explicit choice, which then wins over the incident default', async () => {
    const first = render(<SquireLauncher name="Pip" />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
    const toggle = screen.getByRole('button', { name: 'Dock Pip beside the page' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);
    expect(presentation(first.container)).toBe('docked');
    expect(window.localStorage.getItem(DISPLAY_KEY)).toBe('docked');
    expect(html().style.getPropertyValue(DOCK_WIDTH_VARIABLE)).toBe(DOCK_WIDTH);
    expect(screen.getByLabelText('Message Pip')).toBeInTheDocument();
    first.unmount();
    expect(html().style.getPropertyValue(DOCK_WIDTH_VARIABLE)).toBe('');

    const second = render(<SquireLauncher name="Pip" />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
    expect(presentation(second.container)).toBe('docked');
    fireEvent.click(screen.getByRole('button', { name: 'Float Pip over the page' }));
    expect(presentation(second.container)).toBe('panel');
    expect(window.localStorage.getItem(DISPLAY_KEY)).toBe('floating');
    second.unmount();

    nav.pathname = '/incidents/inc_1';
    const third = render(<SquireLauncher name="Pip" />);
    act(() => openSquire({ question: 'Why?', incidentId: 'inc_1' }));
    await screen.findByRole('dialog');
    expect(presentation(third.container)).toBe('panel');
  });

  it('never docks below the desktop breakpoint or in the full-screen mobile presentation', async () => {
    desktop = false;
    window.localStorage.setItem(DISPLAY_KEY, 'docked');
    nav.pathname = '/incidents/inc_1';
    const narrow = render(<SquireLauncher name="Pip" />);
    act(() => openSquire({ question: 'Why?', incidentId: 'inc_1' }));
    await screen.findByRole('dialog');
    expect(presentation(narrow.container)).toBe('panel');
    expect(html().style.getPropertyValue(DOCK_WIDTH_VARIABLE)).toBe('');
    expect(screen.queryByRole('button', { name: /Dock Pip|Float Pip/ })).not.toBeInTheDocument();
    narrow.unmount();

    desktop = true;
    nav.pathname = '/m/incidents/inc_1';
    const mobile = render(<SquireLauncher name="Pip" fullscreen />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
    expect(presentation(mobile.container)).toBe('fullscreen');
    expect(html().style.getPropertyValue(DOCK_WIDTH_VARIABLE)).toBe('');
    expect(screen.queryByRole('button', { name: /Dock Pip|Float Pip/ })).not.toBeInTheDocument();
  });
});

describe('hand-offs and deep links', () => {
  it('pre-fills a handed-over question without sending it and shows what it is about', async () => {
    nav.pathname = '/incidents/inc_1';
    render(<SquireLauncher name="Pip" />);
    act(() =>
      openSquire({
        question: 'Why is this deploy the likely cause?',
        evidence: { kind: 'change', id: 'f_chg', label: 'Deploy api v9' },
        incidentId: 'inc_1',
      })
    );
    await screen.findByRole('dialog');
    expect(screen.getByLabelText('Message Pip')).toHaveValue(
      'Why is this deploy the likely cause?'
    );
    expect(screen.getByLabelText('Message Pip')).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
    const about = screen.getByRole('status', { name: 'About' });
    expect(within(about).getByRole('link', { name: 'Deploy api v9' })).toHaveAttribute(
      'href',
      '/incidents/inc_1?insights=why#finding-f_chg'
    );
    const dismiss = within(about).getByRole('button', { name: 'Remove this context' });
    expect(dismiss.className).toContain('min-h-11');
    fireEvent.click(dismiss);
    expect(screen.queryByRole('status', { name: 'About' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Message Pip')).toHaveValue(
      'Why is this deploy the likely cause?'
    );
  });

  it('still sends a handed-over message straight away, and drops malformed evidence', async () => {
    fetchMock.mockResolvedValue(streamOf([{ type: 'delta', text: 'Answer.' }, { type: 'done' }]));
    nav.pathname = '/incidents/inc_1';
    render(<SquireLauncher name="Pip" />);
    act(() => {
      window.dispatchEvent(
        new CustomEvent('squire:open', {
          detail: {
            message: 'Summarise this incident',
            evidence: { kind: 'change', id: '../../etc/passwd' },
          },
        })
      );
    });
    expect(await screen.findByText('Answer.')).toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      message: 'Summarise this incident',
      incidentId: 'inc_1',
    });
    expect(screen.queryByRole('status', { name: 'About' })).not.toBeInTheDocument();
  });

  it('opens from ?squire=open&q= with the question ready, never sends it, and cleans the address', async () => {
    window.history.replaceState(
      {},
      '',
      '/services/svc_1?tab=health&squire=open&q=Who%20owns%20this%3F#top'
    );
    nav.pathname = '/services/svc_1';
    render(<SquireLauncher name="Pip" launcher="SEARCH_ONLY" />);
    expect(await screen.findByRole('dialog', { name: /Pip/ })).toBeInTheDocument();
    expect(screen.getByLabelText('Message Pip')).toHaveValue('Who owns this?');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(
      '/services/svc_1?tab=health#top'
    );
  });

  it('ignores other values of the squire parameter', () => {
    window.history.replaceState({}, '', '/incidents?squire=1&q=hello');
    render(<SquireLauncher name="Pip" />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(window.location.search).toBe('?squire=1&q=hello');
  });
});

describe('context chip', () => {
  it.each([
    ['/', 'General conversation'],
    ['/incidents/inc_1', 'Discussing this incident'],
    ['/services/svc_1', 'Discussing this service'],
    ['/teams/t_1', 'Discussing this team'],
    ['/runbooks/rb_1', 'Discussing this runbook'],
    ['/schedules/s_1', 'Discussing this schedule'],
    ['/m/services/svc_1', 'Discussing this service'],
    ['/services/new', 'General conversation'],
  ])('%s shows "%s"', (path, label) => {
    nav.pathname = path;
    render(<SquireLauncher name="Pip" />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});

describe('pinned incident briefing', () => {
  const answerBriefing = (briefing: unknown, chat: unknown[] = []) =>
    fetchMock.mockImplementation(async (url: string) =>
      String(url).startsWith('/api/intelligence/squire/briefing')
        ? { ok: true, status: 200, json: async () => ({ data: { briefing } }) }
        : streamOf(chat)
    );

  it('pins the briefing above an incident conversation, links findings by anchor and remembers collapsing', async () => {
    answerBriefing(briefingFor('inc_b1'));
    nav.pathname = '/incidents/inc_b1';
    const first = render(<SquireLauncher name="Pip" pinBriefing />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
    const pinned = await screen.findByRole('region', { name: 'Incident briefing' });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/intelligence/squire/briefing?incidentId=inc_b1');
    expect(within(pinned).getByText('1 change · 1 similar · 1 runbook')).toBeInTheDocument();
    expect(within(pinned).getByRole('link', { name: /Deploy api v9/ })).toHaveAttribute(
      'href',
      '/incidents/inc_b1?insights=why#finding-f_chg'
    );
    expect(within(pinned).getByText('deploy · 12 min before')).toBeInTheDocument();
    expect(
      within(pinned).getByRole('link', { name: /Checkout latency last month/ })
    ).toHaveAttribute('href', '/incidents/inc_b1?insights=similar#finding-f_sim');
    expect(within(pinned).getByText('82% match · resolved')).toBeInTheDocument();
    expect(within(pinned).getByRole('link', { name: /Restart checkout/ })).toHaveAttribute(
      'href',
      '/incidents/inc_b1?insights=runbooks#finding-f_rb'
    );
    expect(within(pinned).getByText('3 of 4 runs succeeded')).toBeInTheDocument();

    const trigger = within(pinned).getByRole('button', { name: /Incident briefing/ });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger.className).toContain('min-h-11');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(within(pinned).queryByRole('link', { name: /Deploy api v9/ })).not.toBeInTheDocument();
    first.unmount();

    render(<SquireLauncher name="Pip" pinBriefing />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
    const again = await screen.findByRole('region', { name: 'Incident briefing' });
    expect(within(again).getByRole('button', { name: /Incident briefing/ })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
  });

  it('stays silent when there is nothing to pin or the read fails', async () => {
    answerBriefing(null);
    nav.pathname = '/incidents/inc_b2';
    const empty = render(<SquireLauncher name="Pip" pinBriefing />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(screen.queryByRole('region', { name: 'Incident briefing' })).not.toBeInTheDocument();
    empty.unmount();

    fetchMock.mockReset().mockRejectedValue(new Error('offline'));
    nav.pathname = '/incidents/inc_b3';
    render(<SquireLauncher name="Pip" pinBriefing />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(screen.queryByRole('region', { name: 'Incident briefing' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Message Pip')).toBeInTheDocument();
  });

  it('is not requested away from an incident or when pinning is not enabled', async () => {
    nav.pathname = '/services/svc_1';
    const service = render(<SquireLauncher name="Pip" pinBriefing />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();
    service.unmount();

    nav.pathname = '/incidents/inc_b4';
    render(<SquireLauncher name="Pip" />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('adds a finding-anchor link beside a cited source that is one of the incident findings', async () => {
    answerBriefing(briefingFor('inc_b5'), [
      { type: 'delta', text: 'The deploy is the likely cause.' },
      {
        type: 'citations',
        items: [
          { kind: 'change', id: 'chg_1', label: 'Deploy api v9', href: '/changes/chg_1' },
          { kind: 'service', id: 'svc_1', label: 'Checkout', href: '/services/svc_1' },
        ],
      },
      { type: 'done' },
    ]);
    nav.pathname = '/incidents/inc_b5';
    render(<SquireLauncher name="Pip" pinBriefing />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
    await screen.findByRole('region', { name: 'Incident briefing' });
    fireEvent.change(screen.getByLabelText('Message Pip'), { target: { value: 'why?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    const sources = await screen.findByRole('list', { name: 'Sources' });
    // The source keeps its own link; the finding link is an addition, with a full-size target.
    expect(within(sources).getByRole('link', { name: /^Deploy api v9/ })).toHaveAttribute(
      'href',
      '/changes/chg_1'
    );
    const finding = within(sources).getByRole('link', {
      name: "Show Deploy api v9 in this incident's insights",
    });
    expect(finding).toHaveAttribute('href', '/incidents/inc_b5?insights=why#finding-f_chg');
    expect(finding.className).toContain('min-h-11');
    expect(
      within(sources).queryByRole('link', { name: /Show Checkout in this incident/ })
    ).not.toBeInTheDocument();
  });
});

describe('touch targets', () => {
  it('gives the context-mismatch "New chat here" button a 44 px target', async () => {
    nav.pathname = '/incidents/incident-a';
    fetchMock.mockResolvedValue(streamOf([{ type: 'delta', text: 'A answer' }, { type: 'done' }]));
    const { rerender } = render(<SquireLauncher name="Pip" />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
    fireEvent.change(screen.getByLabelText('Message Pip'), { target: { value: 'first' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('A answer')).toBeInTheDocument();
    nav.pathname = '/incidents/incident-b';
    rerender(<SquireLauncher name="Pip" />);
    const button = await screen.findByRole('button', { name: 'New chat here' });
    expect(button.className).toContain('min-h-11');
    expect(button.className).not.toContain('min-h-8');
    expect(screen.getByRole('link', { name: 'Return to original context' }).className).toContain(
      'min-h-11'
    );
  });
});
