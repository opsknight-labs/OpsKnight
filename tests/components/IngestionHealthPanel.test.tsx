// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import IngestionHealthPanel from '@/components/settings/IngestionHealthPanel';
const snapshot = {
  mode: 'postgres',
  counts: {},
  pending: 0,
  pendingBytes: '0',
  oldestPendingAgeSeconds: 0,
  control: {
    paused: false,
    revision: 0,
    policy: {
      maxPending: 100000,
      maxPendingBytes: 1073741824,
      concurrency: 4,
      pollMs: 250,
      leaseMs: 60000,
      payloadRetentionHours: 24,
      receiptRetentionDays: 90,
      criticalReservePercent: 10,
      quotas: {
        eventsPerMinute: 120,
        eventsBurst: 120,
        integrationPerMinute: 100,
        integrationBurst: 100,
      },
    },
  },
  workers: [],
  throughput: {
    windowSeconds: 300,
    acceptedPerSecond: 0,
    completedPerSecond: 0,
    limitedToTopIntegrations: false,
    integrations: [],
  },
  receipts: [],
};
const fetcher = vi.fn();
const response = (pending = 0) => ({
  ok: true,
  json: async () => ({ data: { ...snapshot, pending } }),
});
let visibility: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.useFakeTimers();
  fetcher.mockReset().mockResolvedValue(response());
  vi.stubGlobal('fetch', fetcher);
  visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('live ingestion health', () => {
  it('updates visible health, pauses hidden tabs and refreshes when visible again', async () => {
    render(<IngestionHealthPanel />);
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValue(response(7));
    await advance(30000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(screen.getByText('7')).toBeVisible();
    visibility.mockReturnValue('hidden');
    fireEvent(document, new Event('visibilitychange'));
    await advance(60000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    visibility.mockReturnValue('visible');
    fireEvent(document, new Event('visibilitychange'));
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('does not overlap a pending request and aborts it on unmount', async () => {
    let resolve!: (value: ReturnType<typeof response>) => void;
    fetcher.mockImplementationOnce(
      () =>
        new Promise(done => {
          resolve = done;
        })
    );
    const view = render(<IngestionHealthPanel />);
    await advance(60000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const signal = fetcher.mock.calls[0][1].signal as AbortSignal;
    expect(signal.aborted).toBe(true);
    view.unmount();
    resolve(response());
    await settle();
    await advance(60000);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('preserves policy edits by pausing automatic snapshots while settings are open', async () => {
    render(<IngestionHealthPanel />);
    await settle();
    const summary = screen.getByText('Ingestion capacity settings');
    const details = summary.closest('details')!;
    act(() => {
      details.open = true;
      fireEvent(details, new Event('toggle'));
    });
    await advance(60000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    act(() => {
      details.open = false;
      fireEvent(details, new Event('toggle'));
    });
    await advance(30000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('fetches a new revision after a save even when an older poll was pending', async () => {
    render(<IngestionHealthPanel />);
    await settle();
    let completeOld!: (value: ReturnType<typeof response>) => void;
    fetcher.mockImplementationOnce(
      () =>
        new Promise(done => {
          completeOld = done;
        })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Refresh ingestion status' }));
    const details = screen.getByText('Ingestion capacity settings').closest('details')!;
    act(() => {
      details.open = true;
      fireEvent(details, new Event('toggle'));
    });
    fetcher.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: { ...snapshot, control: { ...snapshot.control, revision: 1 } },
      }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save ingestion settings' }));
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(3); // Initial GET, old poll GET, policy POST.
    completeOld(response());
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls[3][1].cache).toBe('no-store');
    expect(screen.getByRole('button', { name: 'Save ingestion settings' })).toBeEnabled();
  });

  it('loads fresh data after StrictMode cleanup without an aborted-request error', async () => {
    render(
      <StrictMode>
        <IngestionHealthPanel />
      </StrictMode>
    );
    await settle();
    expect(screen.getByText('Admission open')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
