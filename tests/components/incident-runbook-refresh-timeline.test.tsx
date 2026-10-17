import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import IncidentRunbookRefreshButton from '@/components/incident/runbooks/IncidentRunbookRefreshButton';
import { getStepSummary } from '@/components/runbooks/builder/StepNavigator';
import type { RunbookStepDefinition } from '@/lib/runbooks/types';

const refreshMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

describe('IncidentRunbookRefreshButton', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    refreshMock.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders static state when no executions are in-flight', () => {
    render(<IncidentRunbookRefreshButton hasActiveExecutions={false} />);
    expect(screen.queryByText('Live updating')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();
  });

  it('renders live updating beacon when executions are in-flight', () => {
    render(<IncidentRunbookRefreshButton hasActiveExecutions={true} pollIntervalSeconds={3} />);
    expect(screen.getByText('Live updating')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(refreshMock).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(refreshMock).toHaveBeenCalledTimes(2);
  });

  it('triggers manual refresh on click', () => {
    render(<IncidentRunbookRefreshButton hasActiveExecutions={false} />);
    const button = screen.getByRole('button', { name: /refresh/i });
    fireEvent.click(button);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });
});

describe('getStepSummary', () => {
  it('formats KUBERNETES step summary correctly', () => {
    const step: RunbookStepDefinition = {
      key: 'k8s_restart',
      name: 'Restart deployment',
      type: 'KUBERNETES',
      riskClass: 'NON_IDEMPOTENT',
      config: {
        action: 'rollout-restart',
        resource: 'deployment',
        name: 'web-api',
        namespace: 'production',
      },
    };
    expect(getStepSummary(step)).toBe('rollout-restart deployment/web-api (production)');
  });

  it('formats DOCKER step summary correctly', () => {
    const step: RunbookStepDefinition = {
      key: 'docker_start',
      name: 'Start container',
      type: 'DOCKER',
      riskClass: 'IDEMPOTENT_WRITE',
      config: {
        action: 'start',
        container: 'redis-cache',
      },
    };
    expect(getStepSummary(step)).toBe('start container redis-cache');
  });

  it('formats SYSTEMD step summary correctly', () => {
    const step: RunbookStepDefinition = {
      key: 'systemd_status',
      name: 'Check status',
      type: 'SYSTEMD',
      riskClass: 'READ_ONLY',
      config: {
        action: 'status',
        unit: 'nginx.service',
      },
    };
    expect(getStepSummary(step)).toBe('status nginx.service');
  });

  it('formats HTTP step summary correctly', () => {
    const step: RunbookStepDefinition = {
      key: 'http_ping',
      name: 'Health check',
      type: 'HTTP',
      riskClass: 'READ_ONLY',
      config: {
        method: 'POST',
        url: 'https://example.com/api/ping',
      },
    };
    expect(getStepSummary(step)).toBe('POST https://example.com/api/ping');
  });

  it('formats BASH step summary with truncated command', () => {
    const step: RunbookStepDefinition = {
      key: 'bash_clean',
      name: 'Clean logs',
      type: 'BASH',
      riskClass: 'READ_ONLY',
      config: {
        command: 'find /var/log -type f -name "*.log" -mtime +7 -delete',
      },
    };
    expect(getStepSummary(step)).toBe('$ find /var/log -type f -name "*.log"…');
  });

  it('formats WAIT and APPROVAL step summaries', () => {
    const waitStep: RunbookStepDefinition = {
      key: 'wait_step',
      name: 'Wait step',
      type: 'WAIT',
      riskClass: 'READ_ONLY',
      config: {
        durationSeconds: 15,
      },
    };
    expect(getStepSummary(waitStep)).toBe('Wait 15s');

    const approvalStep: RunbookStepDefinition = {
      key: 'approve_step',
      name: 'Gate',
      type: 'APPROVAL',
      riskClass: 'READ_ONLY',
      config: {},
    };
    expect(getStepSummary(approvalStep)).toBe('Approval gate');
  });
});
