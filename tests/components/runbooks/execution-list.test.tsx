import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExecutionRow } from '@/components/runbooks/executions/ExecutionRow';
import {
  ExecutionStatusChips,
  statusChipHref,
} from '@/components/runbooks/executions/ExecutionStatusChips';
import type { ExecutionItemData } from '@/components/runbooks/executions/ExecutionDetailDrawer';
import {
  executionDurationSeconds,
  formatDurationSeconds,
  formatRelativeTime,
} from '@/components/runbooks/executions/format';

const execution: ExecutionItemData = {
  id: 'exec_1',
  status: 'FAILED',
  triggeredByType: 'USER',
  createdAt: '2026-10-16T10:00:00.000Z',
  startedAt: '2026-10-16T10:00:00.000Z',
  completedAt: '2026-10-16T10:01:30.000Z',
  service: { id: 'svc_1', name: 'Payments API' },
  incidentId: 'inc_1',
  incidentTitle: 'Checkout latency',
  runbook: { id: 'rb_1', name: 'Restart payments workers with a very long descriptive name' },
  runbookVersion: { version: 3 },
  resolvedTargetAgent: { name: 'agent-a' },
  resolvedTargetAgentPool: null,
  triggeredByUser: { name: 'Ada' },
  totalSteps: 3,
  completedSteps: 1,
  failedStepName: 'restart',
  rerunBlockedReason: null,
};

describe('ExecutionRow', () => {
  it('shows runbook, service, incident link, trigger, relative start and duration', () => {
    const onSelect = vi.fn();
    render(
      <ExecutionRow
        execution={execution}
        userTimeZone="UTC"
        nowIso="2026-10-16T10:05:00.000Z"
        canExecute
        onSelect={onSelect}
      />
    );
    const inspect = screen.getByRole('button', {
      name: `Inspect execution ${execution.runbook.name} exec_1`,
    });
    expect(inspect).toHaveAttribute('title', `${execution.runbook.name} · v3`);
    expect(screen.getByText('Payments API')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Checkout latency' })).toHaveAttribute(
      'href',
      '/incidents/inc_1?tab=runbooks'
    );
    expect(screen.getByText('Responder · Ada')).toBeInTheDocument();
    expect(screen.getByText('5m ago')).toBeInTheDocument();
    expect(screen.getByText('1m 30s')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open full execution' })).toHaveAttribute(
      'href',
      '/runbooks/executions/exec_1'
    );

    fireEvent.click(screen.getByRole('button', { name: `Re-run ${execution.runbook.name}` }));
    expect(onSelect).toHaveBeenCalledWith(execution);
  });

  it('hides re-run for active executions or without execute permission', () => {
    const { rerender } = render(
      <ExecutionRow
        execution={{ ...execution, status: 'RUNNING', completedAt: null }}
        userTimeZone="UTC"
        canExecute
        onSelect={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: /^Re-run/ })).toBeNull();
    rerender(
      <ExecutionRow
        execution={execution}
        userTimeZone="UTC"
        canExecute={false}
        onSelect={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: /^Re-run/ })).toBeNull();
  });
});

describe('ExecutionStatusChips', () => {
  it('renders counts and keeps existing filter params', () => {
    render(
      <ExecutionStatusChips
        query={{ q: 'payments', service: 'svc_1', page: '3' }}
        counts={{ FAILED: 2, SUCCEEDED: 5, CANCELLED: 1 }}
        selected="FAILED"
      />
    );
    const nav = screen.getByRole('navigation', { name: 'Filter executions by status' });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'All (8)' })).toHaveAttribute(
      'href',
      '/runbooks/executions?q=payments&service=svc_1'
    );
    const failed = screen.getByRole('link', { name: 'Failed (2)' });
    expect(failed).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Cancelled (1)' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Running (0)' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Paused/ })).toBeNull();
  });

  it('builds status hrefs without a stale page', () => {
    expect(statusChipHref({ status: 'FAILED', page: '2' }, 'SUCCEEDED')).toBe(
      '/runbooks/executions?status=SUCCEEDED'
    );
    expect(statusChipHref({ status: 'FAILED' }, null)).toBe('/runbooks/executions');
  });
});

describe('execution formatting', () => {
  it('formats durations and relative times', () => {
    expect(formatDurationSeconds(null)).toBe('Not started');
    expect(formatDurationSeconds(42)).toBe('42s');
    expect(formatDurationSeconds(3725)).toBe('1h 2m');
    expect(executionDurationSeconds('2026-10-16T10:00:00Z', null, '2026-10-16T10:00:10Z')).toBe(10);
    expect(formatRelativeTime('2026-10-16T10:00:00Z', '2026-10-16T10:00:10Z')).toBe('just now');
    expect(formatRelativeTime('2026-10-14T10:00:00Z', '2026-10-16T10:00:00Z')).toBe('2d ago');
  });
});
