import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ pathname: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
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
        read: async () => (index < chunks.length ? { done: false, value: chunks[index++] } : { done: true, value: undefined }),
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
    expect(screen.getByText(/I never change anything/)).toBeInTheDocument();
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
    fireEvent.change(screen.getByLabelText('Message Pip'), { target: { value: 'what is on fire?' } });
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
    fetchMock.mockResolvedValue(streamOf([{ type: 'delta', text: '<img src=x onerror=alert(1)>' }, { type: 'done' }]));
    const { container } = render(<SquireLauncher name="Pip" />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Similar incidents?' }));
    await waitFor(() => expect(screen.getByText(/<img src=x/)).toBeInTheDocument());
    expect(container.querySelector('img')).toBeNull();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ incidentId: 'inc_42', message: 'Similar incidents?' });

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

  it('disables sending an empty message', () => {
    render(<SquireLauncher name="Pip" />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });
});
