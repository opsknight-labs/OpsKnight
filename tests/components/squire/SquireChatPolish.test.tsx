import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ pathname: '/', refresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ refresh: nav.refresh }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
// Count every markdown parse: the real component re-parses its whole text on each render.
const markdownRenders = vi.hoisted(() => [] as string[]);
vi.mock('@/components/squire/SquireMarkdown', () => ({
  default: ({ text }: { text: string }) => {
    markdownRenders.push(text);
    return <div data-testid="markdown">{text}</div>;
  },
}));

import SquireLauncher from '@/components/squire/SquireLauncher';
import { focusableWithin } from '@/components/squire/focus-trap';

const encoder = new TextEncoder();
const line = (event: unknown) => encoder.encode(`${JSON.stringify(event)}\n`);

function streamOf(events: unknown[], init: { status?: number; headers?: Headers } = {}) {
  const chunks = events.map(line);
  let index = 0;
  return {
    ok: (init.status ?? 200) < 400,
    status: init.status ?? 200,
    headers: init.headers ?? new Headers(),
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
  markdownRenders.length = 0;
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function ask(question: string) {
  fireEvent.change(screen.getByLabelText('Message Pip'), { target: { value: question } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
}

describe('streaming batches deltas per animation frame', () => {
  it('renders a long stream a bounded number of times and never re-parses finished answers', async () => {
    // Animation frames run only when the test says so, which makes the frame count deterministic.
    const frames: Array<() => void> = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(() => callback(performance.now()));
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    const runFrames = () => frames.splice(0).forEach(run => run());

    fetchMock.mockResolvedValueOnce(
      streamOf([{ type: 'delta', text: 'First answer.' }, { type: 'done' }])
    );
    render(<SquireLauncher name="Pip" aiEnabled />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
    await ask('first');
    await waitFor(() => expect(screen.getByText('First answer.')).toBeInTheDocument());
    const firstAnswerParses = markdownRenders.filter(text => text === 'First answer.').length;

    // 400 tokens, each arriving in its own macrotask (as a network stream would), with a frame every 40.
    const TOKENS = 400;
    let sent = 0;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      body: {
        getReader: () => ({
          read: async () => {
            await new Promise(resolve => setTimeout(resolve, 0));
            if (sent > 0 && sent % 40 === 0) runFrames();
            if (sent < TOKENS)
              return { done: false, value: line({ type: 'delta', text: `t${sent++} ` }) };
            if (sent === TOKENS) {
              sent += 1;
              return { done: false, value: line({ type: 'done' }) };
            }
            return { done: true, value: undefined };
          },
        }),
      },
    });
    await ask('second');
    const full = Array.from({ length: TOKENS }, (_, index) => `t${index} `).join('');
    await waitFor(
      () => expect(screen.getAllByTestId('markdown').at(-1)).toHaveTextContent(full.trim()),
      {
        timeout: 5000,
      }
    );

    const streamingParses = markdownRenders.filter(text => text.startsWith('t0 ')).length;
    // One parse per frame (10 frames plus the final flush), not one per token (400).
    expect(streamingParses).toBeGreaterThan(0);
    expect(streamingParses).toBeLessThanOrEqual(15);
    // The earlier, finished answer was not parsed again while the new one streamed.
    expect(markdownRenders.filter(text => text === 'First answer.').length).toBe(firstAnswerParses);
  });

  it('keeps the text of the current frame when the response is stopped', async () => {
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      body: new ReadableStream<Uint8Array>({
        start(value) {
          controller = value;
        },
      }),
    });
    render(<SquireLauncher name="Pip" aiEnabled />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
    await ask('go');
    await act(async () => controller.enqueue(line({ type: 'delta', text: 'Partial evidence' })));
    // The frame never ran, so nothing is on screen yet.
    expect(screen.queryByText('Partial evidence')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stop response' }));
    expect(await screen.findByText('Partial evidence')).toBeInTheDocument();
    expect(screen.getByText(/Response stopped/)).toBeInTheDocument();
  });

  it('applies queued text before a later event so the order of the stream is kept', async () => {
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    fetchMock.mockResolvedValue(
      streamOf([
        { type: 'delta', text: 'Partial ' },
        { type: 'error', message: 'The model stopped.' },
      ])
    );
    render(<SquireLauncher name="Pip" aiEnabled />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
    await ask('go');
    // The error keeps the partial text (applied first) and is shown after it.
    expect(await screen.findByText('The model stopped.')).toBeInTheDocument();
    expect(screen.getByTestId('markdown')).toHaveTextContent('Partial');
  });
});

describe('dialog focus management', () => {
  it('is modal, traps Tab inside the dialog and wraps both ways', () => {
    render(<SquireLauncher name="Pip" />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
    const dialog = screen.getByRole('dialog', { name: /Pip/ });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select'
      )
    );
    const first = focusable[0];
    const last = focusable.at(-1)!;
    expect(first).not.toBe(last);

    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(first).toHaveFocus();

    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();

    // In the middle, Tab is left to the browser.
    const middle = focusable[1];
    middle.focus();
    expect(fireEvent.keyDown(middle, { key: 'Tab' })).toBe(true);
    expect(middle).toHaveFocus();
  });

  it('restores focus to where it was when the global shortcut closes the dialog', () => {
    render(
      <>
        <button type="button">Somewhere on the page</button>
        <SquireLauncher name="Pip" launcher="SEARCH_ONLY" />
      </>
    );
    const origin = screen.getByRole('button', { name: 'Somewhere on the page' });
    origin.focus();
    fireEvent.keyDown(window, { key: 'j', metaKey: true });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Message Pip')).toHaveFocus();
    // A held key repeats; it must not toggle the dialog again.
    fireEvent.keyDown(window, { key: 'j', metaKey: true, repeat: true });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'j', ctrlKey: true });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(origin).toHaveFocus();
  });

  it('falls back to the launcher when the element that had focus is gone', () => {
    render(<SquireLauncher name="Pip" />);
    const launcher = screen.getByRole('button', { name: /Ask Pip/ });
    launcher.focus();
    fireEvent.click(launcher);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.getByRole('button', { name: /Ask Pip/ })).toHaveFocus();
  });

  it('announces what the assistant is looking up while it works', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      body: new ReadableStream<Uint8Array>({
        start(value) {
          controller = value;
        },
      }),
    });
    render(<SquireLauncher name="Pip" aiEnabled />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
    await ask('go');
    const progress = screen.getByTestId('squire-progress');
    expect(progress).toHaveAttribute('aria-live', 'polite');
    await act(async () =>
      controller.enqueue(line({ type: 'tool', label: 'Checking recent changes' }))
    );
    await waitFor(() => expect(progress).toHaveTextContent('Checking recent changes…'));
    await act(async () => {
      controller.enqueue(line({ type: 'delta', text: 'Found it.' }));
      controller.enqueue(line({ type: 'done' }));
      controller.close();
    });
    await waitFor(() => expect(progress).toHaveTextContent('Answer complete'));
  });
});

describe('investigation steps in the dialog', () => {
  it('announces the running step and its lookups, and the steps stay inside the focus trap', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      body: new ReadableStream<Uint8Array>({
        start(value) {
          controller = value;
        },
      }),
    });
    render(<SquireLauncher name="Pip" aiEnabled />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
    await ask('investigate');
    const progress = screen.getByTestId('squire-progress');
    const step = (status: string, calls: unknown[] = []) => ({
      type: 'investigation',
      step: { index: 1, title: 'Check recent changes', status, calls },
    });
    await act(async () => controller.enqueue(line(step('running'))));
    await waitFor(() => expect(progress).toHaveTextContent('Step 1: Check recent changes…'));
    await act(async () => controller.enqueue(line({ type: 'tool', label: 'Reading deploys' })));
    await waitFor(() =>
      expect(progress).toHaveTextContent('Step 1: Check recent changes. Reading deploys…')
    );

    // Open while it runs; the list heading and the step are tab stops of the modal dialog.
    const list = screen.getByTestId('squire-investigation');
    expect(list).toHaveAttribute('open');
    const dialog = screen.getByRole('dialog');
    const stops = focusableWithin(dialog);
    const heading = list.querySelector<HTMLElement>(':scope > summary')!;
    const stepSummary = screen.getByLabelText('Step 1: Check recent changes (in progress)');
    expect(stops).toContain(heading);
    expect(stops).toContain(stepSummary);

    await act(async () => {
      controller.enqueue(
        line(step('done', [{ tool: 'get_recent_changes', label: 'Reading deploys', ok: true }]))
      );
      controller.enqueue(line({ type: 'delta', text: 'A deploy went out.' }));
      controller.enqueue(line({ type: 'done' }));
      controller.close();
    });
    await waitFor(() => expect(progress).toHaveTextContent('Answer complete'));
    // Folded once the answer is in: the heading stays reachable, the step inside does not.
    expect(list).not.toHaveAttribute('open');
    expect(screen.getByText(/Investigation · 1 step · 1 read/)).toBeInTheDocument();
    const after = focusableWithin(dialog);
    expect(after).toContain(heading);
    expect(after).not.toContain(screen.getByLabelText('Step 1: Check recent changes (done)'));
  });
});

describe('availability states', () => {
  const notice = () => screen.getByTestId('squire-availability');

  it('shows AI disabled with a settings link only for people who manage AI', () => {
    const { unmount } = render(<SquireLauncher name="Pip" />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
    expect(notice()).toHaveAttribute('data-state', 'disabled');
    expect(notice()).toHaveTextContent('An administrator can turn on AI');
    expect(within(notice()).queryByRole('link')).toBeNull();
    unmount();

    render(<SquireLauncher name="Pip" canManageAi />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
    expect(within(notice()).getByRole('link', { name: 'Turn on AI' })).toHaveAttribute(
      'href',
      '/settings/intelligence/ai'
    );
  });

  it('shows no notice while AI is ready', () => {
    render(<SquireLauncher name="Pip" aiEnabled />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
    expect(screen.queryByTestId('squire-availability')).toBeNull();
    expect(screen.getByText('AI enabled')).toBeInTheDocument();
  });

  it('shows a rate limit with a countdown from Retry-After, then allows a retry', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({ 'Retry-After': '3' }),
      });
      render(<SquireLauncher name="Pip" aiEnabled />);
      fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
      await ask('what is on fire?');
      await waitFor(() => expect(notice()).toHaveAttribute('data-state', 'rate_limited'));
      expect(notice()).toHaveTextContent('Too many requests');
      expect(notice()).toHaveTextContent(/retry in 3 seconds/i);
      const retry = within(notice()).getByRole('button', { name: /Retry in 3s/ });
      expect(retry).toBeDisabled();
      expect(screen.getByText('Rate limited')).toBeInTheDocument();

      // Let the countdown's effect start its interval before the clock moves (it can lag the paint under load).
      await act(async () => {});
      await act(async () => {
        vi.advanceTimersByTime(3_100);
      });
      const ready = within(notice()).getByRole('button', { name: 'Retry' });
      expect(ready).toBeEnabled();

      fetchMock.mockResolvedValueOnce(
        streamOf([
          { type: 'meta', mode: 'ai', name: 'Pip' },
          { type: 'delta', text: 'Ok' },
          { type: 'done' },
        ])
      );
      fireEvent.click(ready);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      expect(JSON.parse(fetchMock.mock.calls[1][1].body).message).toBe('what is on fire?');
      await waitFor(() => expect(screen.queryByTestId('squire-availability')).toBeNull());
    } finally {
      vi.useRealTimers();
    }
  });

  it('tells a reported AI rate limit apart from an exhausted budget', async () => {
    fetchMock.mockResolvedValueOnce(
      streamOf([
        { type: 'notice', text: 'Too many requests. Showing a basic answer.' },
        { type: 'meta', mode: 'basic', name: 'Pip', availability: 'quota', limit: 'rate' },
        { type: 'delta', text: 'Basic answer' },
        { type: 'done' },
      ])
    );
    render(<SquireLauncher name="Pip" aiEnabled />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
    await ask('help');
    await waitFor(() => expect(notice()).toHaveAttribute('data-state', 'rate_limited'));
    expect(within(notice()).getByRole('button', { name: 'Retry' })).toBeEnabled();

    fetchMock.mockResolvedValueOnce(
      streamOf([
        { type: 'meta', mode: 'basic', name: 'Pip', availability: 'quota', limit: 'budget' },
        { type: 'delta', text: 'Basic again' },
        { type: 'done' },
      ])
    );
    await ask('help again');
    await waitFor(() => expect(notice()).toHaveAttribute('data-state', 'budget'));
    expect(notice()).toHaveTextContent('Daily AI budget reached');
    expect(notice()).toHaveTextContent('An administrator can raise it');
    expect(within(notice()).queryByRole('button')).toBeNull();
    expect(screen.getByText('Budget reached · basic mode')).toBeInTheDocument();
  });

  it('treats a quota without a limit (an older server) as the budget, and links admins to it', async () => {
    fetchMock.mockResolvedValueOnce(
      streamOf([
        { type: 'meta', mode: 'basic', name: 'Pip', availability: 'quota' },
        { type: 'delta', text: 'Basic' },
        { type: 'done' },
      ])
    );
    render(<SquireLauncher name="Pip" aiEnabled canManageAi />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
    await ask('help');
    await waitFor(() => expect(notice()).toHaveAttribute('data-state', 'budget'));
    expect(within(notice()).getByRole('link', { name: 'Review AI budget' })).toHaveAttribute(
      'href',
      '/settings/intelligence/ai'
    );
  });

  it('shows basic mode when AI could not answer, offers a retry with AI and clears once AI answers', async () => {
    fetchMock.mockResolvedValueOnce(
      streamOf([
        { type: 'notice', text: 'AI is unavailable right now. Showing a basic answer.' },
        { type: 'meta', mode: 'basic', name: 'Pip', availability: 'unavailable' },
        { type: 'delta', text: 'Basic' },
        { type: 'done' },
      ])
    );
    render(<SquireLauncher name="Pip" aiEnabled />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
    await ask('help');
    await waitFor(() => expect(notice()).toHaveAttribute('data-state', 'basic'));
    expect(notice()).toHaveTextContent('Basic mode · AI unavailable');

    fetchMock.mockResolvedValueOnce(
      streamOf([
        { type: 'meta', mode: 'ai', name: 'Pip' },
        { type: 'delta', text: 'AI' },
        { type: 'done' },
      ])
    );
    fireEvent.click(within(notice()).getByRole('button', { name: 'Retry with AI' }));
    await waitFor(() => expect(screen.queryByTestId('squire-availability')).toBeNull());
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).message).toBe('help');
  });
});
