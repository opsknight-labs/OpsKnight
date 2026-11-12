import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    expect(screen.getByText(/built-in investigation guidance/)).toBeInTheDocument();
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
        {
          type: 'citations',
          items: [
            { kind: 'incident', id: 'abc123', href: '/incidents/abc123', label: 'Read incident' },
            { kind: 'runbook', id: 'rb_1', href: '/runbooks/rb_1', label: 'Read runbook' },
          ],
        },
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

describe('Squire stream recovery', () => {
  async function ask() {
    render(<SquireLauncher name="Pip" />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
    fireEvent.change(screen.getByLabelText('Message Pip'), { target: { value: 'help' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  }

  it('preserves partial text and reports a transport interruption', async () => {
    const encoder = new TextEncoder();
    let reads = 0;
    fetchMock.mockResolvedValue({
      ok: true,
      body: {
        getReader: () => ({
          read: async () => {
            if (reads++ === 0)
              return {
                done: false,
                value: encoder.encode('{"type":"delta","text":"Partial evidence"}\n'),
              };
            throw new Error('connection reset');
          },
          releaseLock: vi.fn(),
        }),
      },
    });
    await ask();
    expect(await screen.findByText('Partial evidence')).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent(/interrupted/i);
  });

  it('reports an incomplete stream instead of leaving an empty answer', async () => {
    fetchMock.mockResolvedValue(streamOf([{ type: 'meta', mode: 'ai' }]));
    await ask();
    expect(await screen.findByText(/response was interrupted/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Message Pip'), { target: { value: 'try again' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled());
  });

  it('reads the final event without a trailing newline and releases the reader', async () => {
    const releaseLock = vi.fn();
    const chunks = [
      new TextEncoder().encode('{"type":"delta","text":"Complete answer"}\n{"type":"done"}'),
    ];
    fetchMock.mockResolvedValue({
      ok: true,
      body: {
        getReader: () => ({
          read: async () =>
            chunks.length ? { done: false, value: chunks.shift() } : { done: true },
          releaseLock,
        }),
      },
    });
    await ask();
    expect(await screen.findByText('Complete answer')).toBeInTheDocument();
    await waitFor(() => expect(releaseLock).toHaveBeenCalledOnce());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

it('stops an active response, aborts its request and retains the partial answer for follow-up', async () => {
  let signal: AbortSignal | undefined;
  fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
    signal = init.signal as AbortSignal;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"type":"delta","text":"Evidence so far"}\n'));
        signal!.addEventListener(
          'abort',
          () => controller.error(new DOMException('Stopped', 'AbortError')),
          { once: true }
        );
      },
    });
    return { ok: true, body };
  });
  render(<SquireLauncher name="Pip" />);
  fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
  fireEvent.change(screen.getByLabelText('Message Pip'), { target: { value: 'investigate' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  expect(await screen.findByText('Evidence so far')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Stop response' }));
  expect(signal?.aborted).toBe(true);
  expect(screen.getByText('Evidence so far')).toBeInTheDocument();
  expect(screen.getByText(/Response stopped/)).toBeInTheDocument();
  expect(screen.getByLabelText('Message Pip')).toHaveFocus();
  fireEvent.change(screen.getByLabelText('Message Pip'), {
    target: { value: 'continue with timeline' },
  });
  expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('keeps a saved incident conversation in its original context', async () => {
  nav.pathname = '/incidents/incident-b';
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      data: {
        conversations: [
          {
            id: 'saved-a',
            title: 'Incident A conversation',
            incidentId: 'incident-a',
            messageCount: 2,
            updatedAt: new Date().toISOString(),
          },
        ],
      },
    }),
  });
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      data: {
        conversation: {
          id: 'saved-a',
          incidentId: 'incident-a',
          messages: [{ role: 'assistant', content: 'Wrong context canary' }],
        },
      },
    }),
  });
  render(<SquireLauncher name="Pip" history={{ retentionDays: 30 }} />);
  fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Saved conversations' }));
  fireEvent.click(await screen.findByRole('button', { name: /^Incident A conversation/ }));
  expect(await screen.findByText('Wrong context canary')).toBeInTheDocument();
  expect(
    screen.getByText('This chat keeps its original context. Choose where to continue.')
  ).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Return to original context' })).toHaveAttribute(
    'href',
    '/incidents/incident-a'
  );
});

it('keeps the original incident scope across navigation until the user starts a new chat', async () => {
  nav.pathname = '/incidents/incident-a';
  fetchMock.mockResolvedValue(
    streamOf([{ type: 'delta', text: 'Earlier answer' }, { type: 'done' }])
  );
  const view = render(<SquireLauncher name="Pip" />);
  fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
  fireEvent.change(screen.getByLabelText('Message Pip'), { target: { value: 'Summarise this' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await screen.findByText('Earlier answer');
  await waitFor(() => expect(screen.getByLabelText('Message Pip')).toBeEnabled());
  nav.pathname = '/incidents/incident-b';
  view.rerender(<SquireLauncher name="Pip" />);
  expect(screen.getByRole('link', { name: 'Return to original context' })).toHaveAttribute(
    'href',
    '/incidents/incident-a'
  );
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'New chat here' }));
  fireEvent.change(screen.getByLabelText('Message Pip'), {
    target: { value: 'Summarise new incident' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
    incidentId: 'incident-b',
    history: [],
  });
});

it('passes server context proofs on the next question and leaves unretrieved links inert', async () => {
  fetchMock.mockResolvedValue(
    streamOf([
      { type: 'delta', text: 'Unverified link /incidents/unread' },
      { type: 'context', userProof: 'user-proof', assistantProof: 'answer-proof' },
      { type: 'done' },
    ])
  );
  render(<SquireLauncher name="Pip" />);
  fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
  fireEvent.change(screen.getByLabelText('Message Pip'), { target: { value: 'Question' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await screen.findByText('Unverified link /incidents/unread');
  await waitFor(() => expect(screen.getByLabelText('Message Pip')).toBeEnabled());
  expect(screen.queryByRole('link', { name: '/incidents/unread' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Message Pip'), { target: { value: 'Follow up' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).history).toEqual([
    { role: 'user', content: 'Question', contextProof: 'user-proof' },
    {
      role: 'assistant',
      content: 'Unverified link /incidents/unread',
      contextProof: 'answer-proof',
    },
  ]);
});

it('loads older chat pages and keeps already loaded history', async () => {
  const row = (id: string) => ({
    id,
    title: `Chat ${id}`,
    incidentId: null,
    messageCount: 2,
    updatedAt: new Date().toISOString(),
  });
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ data: { conversations: [row('new')], nextCursor: 'older-cursor' } }),
  });
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ data: { conversations: [row('old')], nextCursor: null } }),
  });
  render(<SquireLauncher name="Squire" history={{ retentionDays: 90 }} />);
  fireEvent.click(screen.getByRole('button', { name: /Ask Squire/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Saved conversations' }));
  expect(await screen.findByText(/after the last message/)).toHaveTextContent('90');
  fireEvent.click(await screen.findByRole('button', { name: 'Load older chats' }));
  expect(await screen.findByText('Chat old')).toBeInTheDocument();
  expect(screen.getByText('Chat new')).toBeInTheDocument();
  expect(fetchMock.mock.calls[1][0]).toContain('?cursor=older-cursor');
  expect(screen.queryByRole('button', { name: 'Load older chats' })).not.toBeInTheDocument();
});

it('can page past chats filtered out by source permissions', async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ data: { conversations: [], nextCursor: 'next-page' } }),
  });
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      data: {
        conversations: [
          {
            id: 'allowed',
            title: 'Readable older chat',
            incidentId: null,
            messageCount: 2,
            updatedAt: new Date().toISOString(),
          },
        ],
        nextCursor: null,
      },
    }),
  });
  render(<SquireLauncher name="Squire" history={{ retentionDays: 90 }} />);
  fireEvent.click(screen.getByRole('button', { name: /Ask Squire/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Saved conversations' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Load older chats' }));
  expect(await screen.findByText('Readable older chat')).toBeInTheDocument();
});

describe('supplied Squire mascot lifecycle', () => {
  it('stays ready without AI and reflects typing, lookup, streaming and completion', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
    });
    fetchMock.mockResolvedValue({ ok: true, status: 200, body });
    render(<SquireLauncher name="Pip" animated aiEnabled={false} />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
    const dialog = screen.getByRole('dialog');
    const avatar = () => dialog.querySelector('[data-avatar="SQUIRE"] svg')!;
    expect(avatar()).toHaveAttribute('data-state', 'greeting');
    expect(avatar()).toHaveAttribute('data-motion', 'on');
    expect(dialog.querySelector('svg[data-variant="full"]')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Message Pip'), { target: { value: 'Help' } });
    expect(avatar()).toHaveAttribute('data-state', 'listening');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(avatar()).toHaveAttribute('data-state', 'thinking'));
    await act(async () => {
      controller.enqueue(
        new TextEncoder().encode(
          JSON.stringify({ type: 'delta', text: 'Here is some guidance.' }) + '\n'
        )
      );
    });
    // Streamed text is applied on the next animation frame.
    await waitFor(() => expect(avatar()).toHaveAttribute('data-state', 'speaking'));
    await act(async () => {
      controller.enqueue(new TextEncoder().encode('{"type":"done"}\n'));
      controller.close();
    });
    await waitFor(() => expect(avatar()).toHaveAttribute('data-state', 'offline'));
    expect(dialog).toHaveTextContent('Basic mode · AI disabled');
  });

  it('uses the error expression for a failed request and respects disabled animations', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    render(<SquireLauncher name="Pip" animated={false} />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
    fireEvent.change(screen.getByLabelText('Message Pip'), { target: { value: 'Help' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText(/I could not answer that/);
    const avatar = screen.getByRole('dialog').querySelector('[data-avatar="SQUIRE"] svg');
    expect(avatar).toHaveAttribute('data-state', 'error');
    expect(avatar).toHaveAttribute('data-motion', 'off');
  });
});

describe('chat editing and recovery', () => {
  it('regenerates into a new saved thread without deleting or appending to the original', async () => {
    fetchMock
      .mockResolvedValueOnce(
        streamOf([
          { type: 'delta', text: 'Original response' },
          { type: 'conversation', id: 'original-thread' },
          { type: 'done' },
        ])
      )
      .mockResolvedValueOnce(
        streamOf([{ type: 'delta', text: 'Fresh response' }, { type: 'done' }])
      );
    render(<SquireLauncher name="Pip" history={{ retentionDays: 90 }} />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
    fireEvent.change(screen.getByLabelText('Message Pip'), {
      target: { value: 'Help me investigate' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Original response');
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
    await screen.findByText('Fresh response');
    const payload = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(payload).toEqual({ message: 'Help me investigate', history: [] });
    expect(screen.queryByText('Original response')).not.toBeInTheDocument();
    expect(screen.getByText(/Existing saved chats are unchanged/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.every(([, options]) => options.method === 'POST')).toBe(true);
  });
  it('edits a question with a visible branch notice and supports the keyboard shortcut in the composer', async () => {
    fetchMock
      .mockResolvedValueOnce(
        streamOf([{ type: 'delta', text: 'First response' }, { type: 'done' }])
      )
      .mockResolvedValueOnce(
        streamOf([{ type: 'delta', text: 'Edited response' }, { type: 'done' }])
      );
    render(<SquireLauncher name="Pip" />);
    fireEvent.keyDown(window, { key: 'j', ctrlKey: true });
    fireEvent.change(screen.getByLabelText('Message Pip'), { target: { value: 'Help' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('First response');
    fireEvent.click(screen.getByRole('button', { name: 'Edit question' }));
    expect(screen.getByLabelText('Message Pip')).toHaveValue('Help');
    expect(screen.getByText(/Editing a question starts a new version/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Message Pip'), {
      target: { value: 'What is on fire?' },
    });
    fireEvent.keyDown(screen.getByLabelText('Message Pip'), { key: 'Enter' });
    await screen.findByText('Edited response');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      message: 'What is on fire?',
      history: [],
    });
  });
  it('shows server-verified incident attention and does not send while disconnected', async () => {
    nav.pathname = '/incidents/inc_42';
    fetchMock.mockResolvedValueOnce(
      streamOf([
        { type: 'meta', mode: 'basic', availability: 'quota', attention: true },
        { type: 'delta', text: 'A high urgency incident needs attention.' },
        { type: 'done' },
      ])
    );
    const { container } = render(<SquireLauncher name="Pip" />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
    fireEvent.change(screen.getByLabelText('Message Pip'), { target: { value: 'Help' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('A high urgency incident needs attention.');
    expect(container.querySelector('[data-avatar="SQUIRE"] svg')).toHaveAttribute(
      'data-state',
      'alert'
    );
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      act(() => window.dispatchEvent(new Event('offline')));
      fireEvent.change(screen.getByLabelText('Message Pip'), {
        target: { value: 'Keep this draft' },
      });
      expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
      expect(screen.getByLabelText('Message Pip')).toHaveValue('Keep this draft');
      expect(container.querySelector('[data-avatar="SQUIRE"] svg')).toHaveAttribute(
        'data-state',
        'offline'
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      online.mockRestore();
      act(() => window.dispatchEvent(new Event('online')));
    }
  });
});

it('lets the reader stay above a streaming answer and jump back deliberately', async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  fetchMock.mockResolvedValue({
    ok: true,
    body: new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
    }),
  });
  render(<SquireLauncher name="Pip" aiEnabled />);
  fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
  fireEvent.change(screen.getByLabelText('Message Pip'), { target: { value: 'Investigate' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  const log = screen.getByRole('log', { name: 'Conversation' });
  Object.defineProperties(log, {
    scrollHeight: { configurable: true, value: 2000 },
    clientHeight: { configurable: true, value: 400 },
  });
  log.scrollTop = 0;
  fireEvent.scroll(log);
  const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
  scroll.mockClear();
  await act(async () =>
    controller.enqueue(new TextEncoder().encode('{"type":"delta","text":"New evidence"}\n'))
  );
  // Streamed text is applied on the next animation frame.
  const jump = await screen.findByRole('button', { name: 'Jump to latest' });
  expect(scroll).not.toHaveBeenCalled();
  fireEvent.click(jump);
  expect(scroll).toHaveBeenCalled();
  await act(async () => {
    controller.enqueue(new TextEncoder().encode('{"type":"done"}\n'));
    controller.close();
  });
  scroll.mockRestore();
});
