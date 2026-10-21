import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SearchableRunbookSelect } from '@/components/runbooks/SearchableRunbookSelect';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const response = (options: { value: string; label: string }[]) =>
  new Response(JSON.stringify({ options }), { headers: { 'Content-Type': 'application/json' } });

it('disables stale options immediately while a new search is debouncing and fetching', async () => {
  let finish!: (response: Response) => void;
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response([{ value: 'pool:1', label: 'Pool · Reviewed target' }]))
    .mockImplementationOnce(
      () =>
        new Promise<Response>(resolve => {
          finish = resolve;
        })
    )
    .mockResolvedValue(response([{ value: 'pool:1', label: 'Pool · Reviewed target' }]));
  vi.stubGlobal('fetch', fetcher);
  render(<SearchableRunbookSelect kind="target" label="Grant to target" name="target" required />);
  fireEvent.click(screen.getByRole('combobox', { name: 'Select grant to target' }));
  const option = await screen.findByRole('option', { name: 'Pool · Reviewed target' });
  fireEvent.change(screen.getByPlaceholderText('Search grant to target…'), {
    target: { value: 'Reviewed' },
  });
  expect(option).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(option);
  expect(screen.getByRole('combobox', { name: 'Select grant to target' })).not.toHaveTextContent(
    'Reviewed target'
  );
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  await act(async () => {
    finish(response([{ value: 'pool:1', label: 'Pool · Reviewed target' }]));
  });
  await waitFor(() =>
    expect(screen.getByRole('option', { name: 'Pool · Reviewed target' })).toHaveAttribute(
      'aria-disabled',
      'false'
    )
  );
  fireEvent.click(screen.getByRole('option', { name: 'Pool · Reviewed target' }));
  expect(screen.getByRole('combobox', { name: 'Select grant to target' })).toHaveTextContent(
    'Pool · Reviewed target'
  );
});

it('ignores an aborted search response that resolves after a newer search', async () => {
  let old!: (response: Response) => void, latest!: (response: Response) => void;
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response([{ value: 'pool:1', label: 'Initial pool' }]))
    .mockImplementationOnce(
      () =>
        new Promise<Response>(resolve => {
          old = resolve;
        })
    )
    .mockImplementationOnce(
      () =>
        new Promise<Response>(resolve => {
          latest = resolve;
        })
    );
  vi.stubGlobal('fetch', fetcher);
  render(<SearchableRunbookSelect kind="target" label="Grant to target" required />);
  fireEvent.click(screen.getByRole('combobox', { name: 'Select grant to target' }));
  await screen.findByRole('option', { name: 'Initial pool' });
  const input = screen.getByPlaceholderText('Search grant to target…');
  fireEvent.change(input, { target: { value: 'old' } });
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  fireEvent.change(input, { target: { value: 'latest' } });
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
  await act(async () => {
    latest(response([{ value: 'pool:3', label: 'Latest pool' }]));
  });
  await screen.findByRole('option', { name: 'Latest pool' });
  await act(async () => {
    old(response([{ value: 'pool:2', label: 'Stale pool' }]));
  });
  expect(screen.getByRole('option', { name: 'Latest pool' })).toBeVisible();
  expect(screen.queryByRole('option', { name: 'Stale pool' })).not.toBeInTheDocument();
});
