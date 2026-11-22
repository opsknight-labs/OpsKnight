import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import SquireComposer, { type SquireMention } from '@/components/squire/SquireComposer';
import SquireLauncher from '@/components/squire/SquireLauncher';

const RESULTS = [
  { type: 'service', id: 'svc_1', title: 'Checkout API', href: '/services/svc_1' },
  { type: 'user', id: 'usr_1', title: 'Checkout Owner', href: '/users?highlight=usr_1' },
  // Not mentionable: filtered out of the list.
  { type: 'policy', id: 'pol_1', title: 'Checkout policy', href: '/policies/pol_1' },
];

function streamOf(events: unknown[]) {
  const chunks = events.map(event => new TextEncoder().encode(`${JSON.stringify(event)}\n`));
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
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) =>
    String(url).startsWith('/api/search')
      ? { ok: true, status: 200, json: async () => ({ results: RESULTS }) }
      : streamOf([{ type: 'meta', mode: 'basic', name: 'Pip' }, { type: 'done' }])
  );
  vi.stubGlobal('fetch', fetchMock);
});

function Harness({ initial = [] as SquireMention[] }) {
  const [value, setValue] = useState('');
  const [mentions, setMentions] = useState<SquireMention[]>(initial);
  return (
    <>
      <SquireComposer
        name="Pip"
        inputId="squire-input"
        inputRef={{ current: null }}
        value={value}
        maxLength={2000}
        placeholder="Ask"
        onChange={setValue}
        onSubmit={event => event.preventDefault()}
        onKeyDown={() => undefined}
        busy={false}
        canSend
        onStop={() => undefined}
        editing={false}
        onCancelEdit={() => undefined}
        chips={null}
        retentionDays={null}
        fullscreen={false}
        mentions={mentions}
        onMentionsChange={setMentions}
      />
      <output data-testid="mentions">{JSON.stringify(mentions)}</output>
    </>
  );
}

describe('Squire @-mentions', () => {
  it('opens a listbox from @text, picks with the keyboard, and shows a removable chip', async () => {
    render(<Harness />);
    const field = screen.getByLabelText('Message Pip');
    fireEvent.change(field, { target: { value: 'is @Check' } });
    const list = await screen.findByRole('listbox', { name: 'Mention a record' });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/search?q=Check');
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(field).toHaveAttribute('aria-activedescendant', 'squire-input-mentions-0');
    expect(list).toBeInTheDocument();

    fireEvent.keyDown(field, { key: 'ArrowDown' });
    fireEvent.keyDown(field, { key: 'ArrowUp' });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(field).toHaveValue('is @Checkout API ');
    expect(JSON.parse(screen.getByTestId('mentions').textContent!)).toEqual([
      { kind: 'service', id: 'svc_1', label: 'Checkout API' },
    ]);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove mention Checkout API' }));
    expect(JSON.parse(screen.getByTestId('mentions').textContent!)).toEqual([]);
  });

  it('maps people to the person kind and closes on Escape', async () => {
    render(<Harness />);
    const field = screen.getByLabelText('Message Pip');
    fireEvent.change(field, { target: { value: '@Check' } });
    await screen.findByRole('listbox', { name: 'Mention a record' });
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    fireEvent.change(field, { target: { value: '@Checko' } });
    fireEvent.click(await screen.findByRole('option', { name: /Checkout Owner/ }));
    expect(JSON.parse(screen.getByTestId('mentions').textContent!)).toEqual([
      { kind: 'person', id: 'usr_1', label: 'Checkout Owner' },
    ]);
  });

  it('offers nothing once five records are mentioned', async () => {
    const five = Array.from({ length: 5 }, (_, i) => ({
      kind: 'team' as const,
      id: `t${i}`,
      label: `Team ${i}`,
    }));
    render(<Harness initial={five} />);
    fireEvent.change(screen.getByLabelText('Message Pip'), { target: { value: '@Check' } });
    await new Promise(resolve => setTimeout(resolve, 250));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the mentions as kind and id with the question, then clears them', async () => {
    render(<SquireLauncher name="Pip" />);
    fireEvent.click(screen.getByRole('button', { name: /Ask Pip/ }));
    const field = screen.getByLabelText('Message Pip');
    fireEvent.change(field, { target: { value: 'how is @Check' } });
    fireEvent.click(await screen.findByRole('option', { name: /Checkout API/ }));
    expect(screen.getByRole('button', { name: 'Remove mention Checkout API' })).toBeInTheDocument();
    fireEvent.change(field, { target: { value: 'how is @Checkout API doing?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => url === '/api/intelligence/squire')).toBe(true)
    );
    const [, init] = fetchMock.mock.calls.find(([url]) => url === '/api/intelligence/squire')!;
    expect(JSON.parse(init.body)).toEqual({
      message: 'how is @Checkout API doing?',
      history: [],
      mentions: [{ kind: 'service', id: 'svc_1' }],
    });
    expect(
      screen.queryByRole('button', { name: 'Remove mention Checkout API' })
    ).not.toBeInTheDocument();
  });
});
