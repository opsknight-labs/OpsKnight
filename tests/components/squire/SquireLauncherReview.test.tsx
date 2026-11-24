import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/services/svc_1',
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import SquireLauncher from '@/components/squire/SquireLauncher';

const CONVERSATION_KEY = 'opsknight.squire.conversation';

/** Sends `events`, then (with `hang`) waits until the request is aborted. */
function streamOf(events: unknown[], signal?: AbortSignal | null, hang = false) {
  const chunks = events.map(event => new TextEncoder().encode(`${JSON.stringify(event)}\n`));
  let index = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: () =>
          index < chunks.length
            ? Promise.resolve({ done: false, value: chunks[index++] })
            : hang
              ? new Promise((_, reject) =>
                  signal?.addEventListener('abort', () =>
                    reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
                  )
                )
              : Promise.resolve({ done: true, value: undefined }),
        releaseLock: () => undefined,
      }),
    },
  };
}

const fetchMock = vi.fn();
beforeEach(() => {
  window.sessionStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
    String(url).startsWith('/api/intelligence/squire/background')
      ? Response.json({ data: { turns: [] } })
      : fetchMock(url, init)
  );
});
afterEach(() => vi.unstubAllGlobals());

const chatCalls = () => fetchMock.mock.calls.filter(([url]) => url === '/api/intelligence/squire');

const ask = (question: string) => {
  fireEvent.change(screen.getByLabelText('Message Pip'), { target: { value: question } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
};

describe('Squire launcher review fixes', () => {
  it('does not queue Enter while an answer streams, and the live answer carries the page context', async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      streamOf(
        [
          { type: 'meta', mode: 'basic' },
          { type: 'delta', text: 'Working' },
        ],
        init?.signal,
        true
      )
    );
    render(<SquireLauncher name="Pip" />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
    ask('First question');
    await screen.findByText('Working');
    const field = screen.getByLabelText('Message Pip');
    fireEvent.change(field, { target: { value: 'Second question' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    // Still in the box, not sent out of sight.
    expect(field).toHaveValue('Second question');
    fireEvent.click(screen.getByRole('button', { name: 'Stop response' }));
    await screen.findByText(/Response stopped/);
    expect(chatCalls()).toHaveLength(1);

    // 👎 on the live answer names the service it was asked about.
    fireEvent.click(screen.getByRole('button', { name: 'Unhelpful answer' }));
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 201 }));
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => url === '/api/intelligence/squire/feedback')
      ).toBe(true)
    );
    const [, init] = fetchMock.mock.calls.find(
      ([url]) => url === '/api/intelligence/squire/feedback'
    )!;
    expect(JSON.parse(String(init.body))).toMatchObject({ serviceId: 'svc_1' });
  });

  it('does not call an answer stalled once it is done, while the save is slow', async () => {
    const timeout = vi.spyOn(window, 'setTimeout');
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      streamOf([{ type: 'delta', text: 'All good' }, { type: 'done' }], init?.signal, true)
    );
    try {
      render(<SquireLauncher name="Pip" />);
      fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
      ask('How is checkout?');
      await screen.findByText('All good');
      await waitFor(() => expect(timeout.mock.calls.some(([, ms]) => ms === 45_000)).toBe(true));
      const last = timeout.mock.calls.filter(([, ms]) => ms === 45_000).at(-1)!;
      await act(async () => (last[0] as () => void)());
      await screen.findByRole('button', { name: 'Send' });
      expect(screen.queryByText(/stalled/)).not.toBeInTheDocument();
    } finally {
      timeout.mockRestore();
    }
  });

  it('asks before deleting one saved chat', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
      init?.method === 'DELETE'
        ? new Response(null, { status: 204 })
        : Response.json({
            data: {
              conversations: [
                {
                  id: 'c1',
                  title: 'Checkout',
                  incidentId: null,
                  messageCount: 2,
                  updatedAt: new Date().toISOString(),
                },
              ],
              nextCursor: null,
            },
          })
    );
    render(<SquireLauncher name="Pip" history={{ retentionDays: 30 }} />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Saved conversations' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete conversation: Checkout' }));
    const confirm = screen.getByRole('group', { name: 'Confirm deleting Checkout' });
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/intelligence/squire/conversations/c1', {
        method: 'DELETE',
      })
    );
    expect(confirm).not.toBeInTheDocument();
  });

  it('keeps the stored conversation while it is restored, and a newer question wins', async () => {
    window.sessionStorage.setItem(CONVERSATION_KEY, 'conv-1');
    let finish: (value: unknown) => void = () => undefined;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
      url === '/api/intelligence/squire'
        ? streamOf([{ type: 'delta', text: 'Fresh answer' }, { type: 'done' }], init?.signal)
        : new Promise(resolve => (finish = resolve))
    );
    render(<SquireLauncher name="Pip" history={{ retentionDays: 30 }} />);
    // Mounting does not wipe the id the restore is still reading.
    expect(window.sessionStorage.getItem(CONVERSATION_KEY)).toBe('conv-1');
    fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
    ask('A new question');
    await screen.findByText('Fresh answer');
    await act(async () =>
      finish({
        ok: true,
        json: async () => ({
          data: {
            conversation: {
              id: 'conv-1',
              incidentId: null,
              messages: [{ role: 'assistant', content: 'Old saved answer' }],
            },
          },
        }),
      })
    );
    expect(screen.queryByText('Old saved answer')).not.toBeInTheDocument();
    expect(screen.getByText('Fresh answer')).toBeInTheDocument();
  });
});
