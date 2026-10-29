import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ pathname: '/', refresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ refresh: nav.refresh }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import SquireLauncher from '@/components/squire/SquireLauncher';

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

const fetchMock = vi.fn();
beforeEach(() => {
  nav.pathname = '/';
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('SquireLauncher', () => {
  it('shows a named launcher and opens an accessible dialog', () => {
    render(<SquireLauncher name="Pip" />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
    expect(screen.getByRole('dialog', { name: /Pip/ })).toBeInTheDocument();
    expect(screen.getByLabelText('Message Pip')).toHaveFocus();
    expect(screen.getByText(/they only happen if you confirm them/)).toBeInTheDocument();
  });

  it('closes with Escape and the close button', () => {
    render(<SquireLauncher name="Pip" />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Close Pip' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens from the squire:open event so other UI (a command palette) can launch it', async () => {
    render(<SquireLauncher name="Pip" />);
    window.dispatchEvent(new Event('squire:open'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('streams an answer, shows the basic-mode note, and links only internal paths', async () => {
    fetchMock.mockResolvedValue(
      streamOf([
        { type: 'meta', mode: 'basic', name: 'Pip' },
        { type: 'delta', text: 'See /incidents/abc123 and https://evil.example/incidents/x ' },
        { type: 'delta', text: 'and /runbooks/rb_1' },
        { type: 'done' },
      ])
    );
    render(<SquireLauncher name="Pip" />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
    fireEvent.change(screen.getByLabelText('Message Pip'), {
      target: { value: 'what is on fire?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText(/Basic answer from your incident data/)).toBeInTheDocument();
    const hrefs = screen.getAllByRole('link').map(a => a.getAttribute('href'));
    expect(hrefs).toContain('/incidents/abc123');
    expect(hrefs).toContain('/runbooks/rb_1');
    expect(hrefs.some(h => h?.startsWith('http'))).toBe(false);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/intelligence/squire');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ message: 'what is on fire?', history: [] });
  });

  it('sends the incident being viewed and recent history, and never renders HTML from the model', async () => {
    nav.pathname = '/incidents/inc_42/overview';
    fetchMock.mockResolvedValue(
      streamOf([{ type: 'delta', text: '<img src=x onerror=alert(1)>' }, { type: 'done' }])
    );
    const { container } = render(<SquireLauncher name="Pip" />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Similar incidents?' }));
    await waitFor(() => expect(screen.getByText(/<img src=x/)).toBeInTheDocument());
    expect(container.querySelector('img')).toBeNull();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      incidentId: 'inc_42',
      message: 'Similar incidents?',
    });

    fetchMock.mockResolvedValue(streamOf([{ type: 'delta', text: 'ok' }, { type: 'done' }]));
    fireEvent.change(screen.getByLabelText('Message Pip'), { target: { value: 'and runbooks?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const second = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(second.history).toEqual([
      { role: 'user', content: 'Similar incidents?' },
      { role: 'assistant', content: '<img src=x onerror=alert(1)>' },
    ]);
  });

  it('does not treat the new-incident page as an incident and shows server failures kindly', async () => {
    nav.pathname = '/incidents/new';
    fetchMock.mockResolvedValue({ ok: false, status: 500, body: null });
    render(<SquireLauncher name="Pip" />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
    fireEvent.change(screen.getByLabelText('Message Pip'), { target: { value: 'help' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(/could not answer that/i)).toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty('incidentId');
  });

  it('announces itself for the global search while mounted and withdraws on unmount', () => {
    const { unmount } = render(<SquireLauncher name="Pip" />);
    expect(document.documentElement.dataset.squireName).toBe('Pip');
    unmount();
    expect(document.documentElement.dataset.squireName).toBeUndefined();
  });

  it('can hide the floating button while still opening from other entry points', async () => {
    render(<SquireLauncher name="Pip" launcher="SEARCH_ONLY" />);
    expect(screen.queryByRole('button', { name: /Ask Pip/ })).toBeNull();
    window.dispatchEvent(new Event('squire:open'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('asks a question handed over by another part of the page', async () => {
    fetchMock.mockResolvedValue(
      streamOf([{ type: 'delta', text: 'Here is what I found.' }, { type: 'done' }])
    );
    nav.pathname = '/incidents/inc_7';
    render(<SquireLauncher name="Pip" />);
    window.dispatchEvent(
      new CustomEvent('squire:open', { detail: { message: 'Have we seen this before?' } })
    );
    expect(await screen.findByText('Here is what I found.')).toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      message: 'Have we seen this before?',
      incidentId: 'inc_7',
    });
  });

  it('does not lose a request made before the launcher has mounted', async () => {
    const { openSquire } = await import('@/components/squire/SquireLauncher');
    fetchMock.mockResolvedValue(
      streamOf([{ type: 'delta', text: 'Queued answer.' }, { type: 'done' }])
    );
    openSquire('Summarise this incident');
    render(<SquireLauncher name="Pip" />);
    expect(await screen.findByText('Queued answer.')).toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      message: 'Summarise this incident',
    });
  });

  it('ignores a malformed hand-off instead of sending it', async () => {
    render(<SquireLauncher name="Pip" />);
    window.dispatchEvent(new CustomEvent('squire:open', { detail: { message: { evil: true } } }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('moves to the other side and remembers the choice', () => {
    window.localStorage.removeItem('opsknight.squire.side');
    const { container, unmount } = render(<SquireLauncher name="Pip" />);
    expect(container.querySelector('[data-side]')!.getAttribute('data-side')).toBe('right');
    fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Move Pip to the left side' }));
    expect(container.querySelector('[data-side]')!.getAttribute('data-side')).toBe('left');
    unmount();
    const again = render(<SquireLauncher name="Pip" />);
    expect(again.container.querySelector('[data-side]')!.getAttribute('data-side')).toBe('left');
    window.localStorage.removeItem('opsknight.squire.side');
  });

  it('returns focus to the launcher when closed', () => {
    render(<SquireLauncher name="Pip" />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Close Pip' }));
    expect(screen.getByRole('button', { name: /Ask Pip/ })).toHaveFocus();
  });

  it('shows the chosen mascot', () => {
    const { container } = render(<SquireLauncher name="Pip" avatar="OWL" />);
    expect(container.querySelector('[data-avatar="OWL"]')).not.toBeNull();
  });

  it('shows a suggested action that does nothing until confirmed, then runs it with only the sealed token', async () => {
    nav.pathname = '/incidents/inc_42';
    fetchMock.mockResolvedValueOnce(
      streamOf([
        { type: 'meta', mode: 'ai', name: 'Pip' },
        { type: 'tool', label: 'Reading the timeline' },
        { type: 'delta', text: 'You could acknowledge it.' },
        {
          type: 'proposal',
          proposal: {
            token: 'sealed-1',
            action: 'acknowledge_incident',
            kind: 'WRITE',
            title: 'Acknowledge incident',
            detail: 'Acknowledge “DB down”.',
            incidentId: 'inc_42',
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          },
        },
        { type: 'done' },
      ])
    );
    render(<SquireLauncher name="Pip" />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
    fireEvent.change(screen.getByLabelText('Message Pip'), { target: { value: 'ack it' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    const card = await screen.findByRole('group', {
      name: /Suggested action: Acknowledge incident/,
    });
    expect(card).toHaveTextContent('Acknowledge “DB down”.');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, message: 'Incident acknowledged.' }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('Incident acknowledged.')).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('/api/intelligence/squire/actions');
    expect(JSON.parse(init.body)).toEqual({ token: 'sealed-1' });
    expect(nav.refresh).toHaveBeenCalled();
  });

  it('keeps partial text and says when an answer was cut off', async () => {
    fetchMock.mockResolvedValue(
      streamOf([
        { type: 'delta', text: 'The first half' },
        { type: 'error', message: 'The response was interrupted' },
      ])
    );
    render(<SquireLauncher name="Pip" />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
    fireEvent.change(screen.getByLabelText('Message Pip'), { target: { value: 'tell me' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('The first half')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('The response was interrupted');
  });

  it('shows checked sources and follow-up questions, and trims long answers before sending them back', async () => {
    fetchMock.mockResolvedValue(
      streamOf([
        { type: 'delta', text: 'x'.repeat(6_000) },
        {
          type: 'citations',
          items: [{ kind: 'incident', id: 'abc', label: 'Checkout down', href: '/incidents/abc' }],
        },
        { type: 'suggestions', items: ['Who is on call?'] },
        { type: 'done' },
      ])
    );
    render(<SquireLauncher name="Pip" />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
    fireEvent.change(screen.getByLabelText('Message Pip'), { target: { value: 'long please' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('link', { name: 'Checkout down' })).toHaveAttribute(
      'href',
      '/incidents/abc'
    );

    fetchMock.mockResolvedValue(streamOf([{ type: 'delta', text: 'ok' }, { type: 'done' }]));
    fireEvent.click(await screen.findByRole('button', { name: 'Who is on call?' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const history = JSON.parse(fetchMock.mock.calls[1][1].body).history;
    expect(history[1].content).toHaveLength(4_000);
  });

  it('keeps an answer that arrives while the panel is closed', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>(resolve => (release = resolve));
    const encoder = new TextEncoder();
    const chunks = [{ type: 'delta', text: 'Arrived later' }, { type: 'done' }].map(e =>
      encoder.encode(`${JSON.stringify(e)}\n`)
    );
    let index = 0;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => {
            await gate;
            return index < chunks.length
              ? { done: false, value: chunks[index++] }
              : { done: true, value: undefined };
          },
        }),
      },
    });
    render(<SquireLauncher name="Pip" />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
    fireEvent.change(screen.getByLabelText('Message Pip'), { target: { value: 'slow one' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close Pip' }));
    release();
    fireEvent.click(await screen.findByRole('button', { name: /Ask Pip/ }));
    expect(await screen.findByText('Arrived later')).toBeInTheDocument();
  });

  it('disables sending an empty message', () => {
    render(<SquireLauncher name="Pip" />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });
});
