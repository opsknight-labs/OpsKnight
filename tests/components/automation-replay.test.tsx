import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AutomationReplay } from '@/components/automation/AutomationReplay';
import { emptySnapshot } from '@/lib/automation/contract';
import type { AutomationReplayView } from '@/lib/automation/replay-run';

const api = vi.hoisted(() => ({ action: vi.fn() }));
vi.mock('@/app/(app)/services/[id]/automation/actions', () => ({ automationAction: api.action }));

const result = {
  eventsEvaluated: 120,
  same: 100,
  routeChanged: 15,
  priorityChanged: 5,
  noEscalationChanged: 0,
  fallbacks: 0,
  overDeadline: 0,
  defaultRouted: 30,
  unmappedEvents: 4,
  unmappedFields: { region: 4 },
  tagged: 0,
  tags: [],
  rules: [
    { ruleId: 'a', name: 'DB alerts', phase: 'ROUTE', matched: 0, shadowed: 0 },
    { ruleId: 'b', name: 'Late rule', phase: 'ROUTE', matched: 0, shadowed: 7 },
  ],
  transitions: [],
  priorityTransitions: [],
  evaluationMs: { p50: 0.1, p99: 0.4, max: 1 },
  examples: [],
  alertsScanned: 120,
  truncated: false,
} as unknown as AutomationReplayView['result'];

const view = (status: AutomationReplayView['status'], progress = 0): AutomationReplayView => ({
  runId: 'run-1',
  status,
  days: 7,
  progress,
  result: status === 'COMPLETED' ? result : null,
  error: null,
  createdAt: new Date().toISOString(),
});

beforeEach(() => {
  vi.useFakeTimers();
  api.action.mockReset();
});
afterEach(() => vi.useRealTimers());

it('starts a replay, shows progress, then what would have changed', async () => {
  api.action
    .mockResolvedValueOnce({ ok: true, data: view('RUNNING', 0.5) })
    .mockResolvedValueOnce({ ok: true, data: view('COMPLETED', 1) });
  const snapshot = emptySnapshot;
  render(<AutomationReplay serviceId="svc" snapshot={snapshot} />);

  expect(screen.getByRole('heading', { name: /replay against last 7 days/i })).toBeTruthy();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Replay' })));
  expect(api.action).toHaveBeenCalledWith({
    action: 'replay',
    serviceId: 'svc',
    snapshot,
    days: 7,
  });
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('50');

  await act(async () => void (await vi.advanceTimersByTimeAsync(1500)));
  expect(api.action).toHaveBeenLastCalledWith({
    action: 'replayStatus',
    serviceId: 'svc',
    runId: 'run-1',
  });
  expect(screen.queryByRole('progressbar')).toBeNull();
  expect(screen.getByText('Route changes').nextSibling?.textContent).toBe('15');
  expect(screen.getByText('Never matched: DB alerts')).toBeTruthy();
  expect(screen.getByText(/Always decided by an earlier rule:\s*Late rule/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Replay again' })).toBeTruthy();
});

it('stops showing progress when the status check fails', async () => {
  api.action
    .mockResolvedValueOnce({ ok: true, data: view('PENDING') })
    .mockRejectedValueOnce(new Error('network'));
  render(<AutomationReplay serviceId="svc" snapshot={emptySnapshot} />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Replay' })));
  await act(async () => void (await vi.advanceTimersByTimeAsync(1500)));
  expect(screen.getByRole('alert').textContent).toMatch(/could not check the replay/i);
  expect(screen.queryByRole('progressbar')).toBeNull();
  expect((screen.getByRole('button', { name: 'Replay' }) as HTMLButtonElement).disabled).toBe(
    false
  );
});
