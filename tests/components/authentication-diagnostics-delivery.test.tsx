import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AuthenticationDiagnostics from '@/components/settings/AuthenticationDiagnostics';
const data = {
  registeredSessions: [],
  pendingEmailAlerts: 2,
  failedEmailAlertCount: 1,
  pendingEmailFanoutJobs: 1,
  deliveredEmailAlertCount: 12,
  acceptedEmailAlertCount: 2,
  cancelledEmailAlertCount: 3,
  replicas: [],
  events: [],
};
const item = {
  id: 'alert-1',
  title: 'Provider activation',
  subtitle: 'Event one',
  state: 'FAILED',
  createdAt: '2026-10-14T00:00:00Z',
  activityAt: '2026-10-14T00:00:00Z',
  source: 'AuthenticationAlert',
  details: [],
  canRetry: true,
  generation: 3,
  actionExplanation: 'A retry may deliver a duplicate.',
};
const page = {
  items: [item],
  nextCursor: null,
  hasMore: false,
  pageSize: 25,
  snapshotAt: '2026-10-15T00:00:00Z',
};
const props = {
  data,
  pending: false,
  onRefresh: vi.fn(),
  onRevoke: vi.fn(),
  onRetry: vi.fn().mockResolvedValue(true),
};
const deliveries = async () => {
  fireEvent.click(screen.getByRole('tab', { name: 'Security notifications' }));
  await screen.findByRole('button', { name: 'View Provider activation' });
};
beforeEach(() => {
  window.history.replaceState(null, '', '/');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ data: page }))
  );
});
afterEach(() => vi.unstubAllGlobals());
describe('paginated diagnostic interactions', () => {
  it('requires explicit acknowledgment and sends the displayed retry generation', async () => {
    const retry = vi.fn().mockResolvedValue(true);
    render(<AuthenticationDiagnostics {...props} onRetry={retry} />);
    await deliveries();
    fireEvent.click(screen.getByRole('button', { name: 'View Provider activation' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Confirm email retry' })).toBeDisabled();
    expect(retry).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm email retry' }));
    await waitFor(() => expect(retry).toHaveBeenCalledWith('alert-1', 3));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
  it('keeps confirmation after rejection and closes only on success', async () => {
    const retry = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<AuthenticationDiagnostics {...props} onRetry={retry} />);
    await deliveries();
    fireEvent.click(screen.getByRole('button', { name: 'View Provider activation' }));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm email retry' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Confirm email retry' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm email retry' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
  it('retains filters and page after unrelated dashboard refresh and view changes', async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL) =>
      Response.json({
        data: String(url).includes('after=older')
          ? { ...page, items: [{ ...item, id: 'older', title: 'Older alert' }] }
          : { ...page, hasMore: true, nextCursor: 'older' },
      })
    );
    vi.stubGlobal('fetch', fetcher);
    const { rerender } = render(<AuthenticationDiagnostics {...props} />);
    await deliveries();
    fireEvent.click(
      within(screen.getByRole('navigation', { name: 'Top diagnostic pagination' })).getByRole(
        'button',
        { name: 'Next page' }
      )
    );
    await screen.findByText('Older alert');
    const calls = fetcher.mock.calls.length;
    rerender(<AuthenticationDiagnostics {...props} data={{ ...data, failedEmailAlertCount: 2 }} />);
    expect(fetcher.mock.calls.length).toBe(calls);
    fireEvent.click(screen.getByRole('tab', { name: 'Recovery & audit' }));
    await screen.findByText('Provider activation');
    fireEvent.click(screen.getByRole('tab', { name: 'Security notifications' }));
    await screen.findByText('Older alert');
    expect(String(fetcher.mock.calls.at(-1)?.[0])).toContain('after=older');
  });
  it('ignores late responses from an abandoned view', async () => {
    let finish!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: RequestInfo | URL) =>
        String(url).includes('view=sessions')
          ? new Promise<Response>(resolve => {
              finish = resolve;
            })
          : Promise.resolve(Response.json({ data: page }))
      )
    );
    render(<AuthenticationDiagnostics {...props} />);
    await deliveries();
    await act(async () =>
      finish(Response.json({ data: { ...page, items: [{ ...item, title: 'Stale session' }] } }))
    );
    expect(screen.queryByText('Stale session')).not.toBeInTheDocument();
    expect(screen.getByText('Provider activation')).toBeInTheDocument();
  });
  it('preserves filters on API failures and exposes page retry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ error: 'Authority expired' }, { status: 403 }))
    );
    render(<AuthenticationDiagnostics {...props} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Authority expired');
    expect(screen.getByRole('button', { name: 'Retry this page' })).toBeEnabled();
  });
});
