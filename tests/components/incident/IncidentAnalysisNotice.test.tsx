import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TimezoneProvider } from '@/contexts/TimezoneContext';
import IncidentAnalysisNotice from '@/components/incident/IncidentAnalysisNotice';
import type { IncidentAnalysisState } from '@/lib/intelligence/analysis/contract';
const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
const waiting: IncidentAnalysisState = {
  status: 'WAITING',
  message: 'Waiting for recommendation analysis.',
  canRefresh: false,
};
const fetchMock = vi.fn();
const response = (analysis: IncidentAnalysisState) => ({
  ok: true,
  status: 200,
  json: async () => ({ data: { analysis } }),
});
beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockReset();
  fetchMock.mockReset().mockResolvedValue(response(waiting));
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it('caps automatic requests and permits an explicit check after the budget is spent', async () => {
  render(<IncidentAnalysisNotice incidentId="incident-1" initial={waiting} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300_000);
  });
  expect(fetchMock).toHaveBeenCalledTimes(8);
  expect(fetchMock.mock.calls.every(([, init]) => init.method === undefined)).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(fetchMock).toHaveBeenCalledTimes(9);
  expect(screen.queryByRole('button', { name: 'Refresh recommendations' })).not.toBeInTheDocument();
});
it('makes no hidden-tab requests and cancels a pending read when unmounted', async () => {
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  fetchMock.mockReturnValue(new Promise(() => undefined));
  const view = render(<IncidentAnalysisNotice incidentId="incident-1" initial={waiting} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(fetchMock).not.toHaveBeenCalled();
  visibility.mockReturnValue('visible');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15_000);
  });
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  view.unmount();
  expect(signal.aborted).toBe(true);
});
it('refreshes server-rendered suggestions once when waiting analysis completes, then stops polling', async () => {
  fetchMock.mockResolvedValue(
    response({
      status: 'CURRENT',
      message: 'Recommendations checked.',
      lastSuccessfulAt: '2026-11-04T05:00:00.000Z',
      canRefresh: false,
    })
  );
  render(<IncidentAnalysisNotice incidentId="incident-1" initial={waiting} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(screen.getByText('Recommendations checked.')).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(refresh).toHaveBeenCalledTimes(1);
});
it('never automatically requests analysis and uses a bounded operator request only after a click', async () => {
  fetchMock.mockResolvedValueOnce({ ok: true, status: 202 });
  render(
    <IncidentAnalysisNotice
      incidentId="incident-1"
      initial={{
        status: 'CURRENT',
        message: 'Recommendations checked.',
        canRefresh: true,
        diagnosticsHref: '/settings/intelligence',
      }}
    />
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(fetchMock).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Refresh recommendations' }));
  });
  expect(fetchMock.mock.calls[0]).toEqual([
    '/api/intelligence/incidents/incident-1/analysis',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
  ]);
  expect(screen.getByRole('link', { name: 'Operator diagnostics' })).toHaveAttribute(
    'href',
    '/settings/intelligence'
  );
});
it('stops polling and refreshes source authorization after access is revoked', async () => {
  fetchMock.mockResolvedValue({
    ok: false,
    status: 404,
    json: async () => ({ error: 'Analysis not found' }),
  });
  render(<IncidentAnalysisNotice incidentId="incident-1" initial={waiting} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(refresh).toHaveBeenCalledTimes(1);
});

it('makes no automatic requests while the panel is outside the viewport', async () => {
  let intersect!: (entries: Array<{ isIntersecting: boolean }>) => void;
  const disconnect = vi.fn();
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: typeof intersect) {
        intersect = callback;
      }
      observe = vi.fn();
      disconnect = disconnect;
    }
  );
  const view = render(<IncidentAnalysisNotice incidentId="incident-1" initial={waiting} />);
  act(() => intersect([{ isIntersecting: false }]));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(fetchMock).not.toHaveBeenCalled();
  act(() => intersect([{ isIntersecting: true }]));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15_000);
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(disconnect).toHaveBeenCalledTimes(1);
});

it('shows the completion time in the responder’s preferred timezone', () => {
  render(
    <TimezoneProvider initialTimeZone="Asia/Kolkata">
      <IncidentAnalysisNotice
        incidentId="incident-1"
        initial={{
          ...waiting,
          status: 'CURRENT',
          lastSuccessfulAt: '2026-11-04T05:00:00.000Z',
        }}
      />
    </TimezoneProvider>
  );
  const notice = screen.getByRole('group', { name: 'Recommendation freshness' });
  const time = notice.querySelector('time');
  expect(time).toHaveAttribute('datetime', '2026-11-04T05:00:00.000Z');
  expect(time?.textContent).toContain('10:30');
});
