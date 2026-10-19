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

  it('pauses polling when document tab is hidden in background', () => {
    const visibilitySpy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    render(<IncidentRunbookRefreshButton hasActiveExecutions={true} pollIntervalSeconds={2} />);

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(refreshMock).not.toHaveBeenCalled();

    visibilitySpy.mockReturnValue('visible');
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(refreshMock).toHaveBeenCalledTimes(1);
    visibilitySpy.mockRestore();
  });

  it('polls open incident even before active executions are created to catch background triggers', () => {
    render(
      <IncidentRunbookRefreshButton
        hasActiveExecutions={false}
        isIncidentOpen={true}
        pollIntervalSeconds={2}
      />
    );
    // When incident is open without active executions, polls at effective interval (e.g. 6000ms)
    act(() => {
      vi.advanceTimersByTime(5900);
    });
    expect(refreshMock).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(200);
    });
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

  it('formats HTTP step summary correctly and strips sensitive query parameters', () => {
    const step: RunbookStepDefinition = {
      key: 'http_ping',
      name: 'Health check',
      type: 'HTTP',
      riskClass: 'READ_ONLY',
      config: {
        method: 'POST',
        url: 'https://example.com/api/ping?token=supersecret123&apiKey=xyz456',
      },
    };
    expect(getStepSummary(step)).toBe('POST https://example.com/api/ping');
  });

  it('formats BASH step summary with safe action descriptor and completely prevents secret leakage', () => {
    const step: RunbookStepDefinition = {
      key: 'bash_clean',
      name: 'Clean logs',
      type: 'BASH',
      riskClass: 'NON_IDEMPOTENT',
      config: {
        interpreter: 'bash',
        command:
          'curl -H "Authorization: Bearer super_secret_token_12345" https://internal.corp/wipe',
      },
    };
    const summary = getStepSummary(step);
    expect(summary).toBe('Execute script (bash)');

    // Adversarial assertion: recognizable credentials must NEVER appear in summary text
    expect(summary).not.toContain('super_secret_token_12345');
    expect(summary).not.toContain('Authorization');
    expect(summary).not.toContain('https://internal.corp/wipe');
  });

  it('formats LINUX_DIAGNOSTICS step summary using typed config.diagnostic', () => {
    const step: RunbookStepDefinition = {
      key: 'diag_uptime',
      name: 'Collect uptime',
      type: 'LINUX_DIAGNOSTICS',
      riskClass: 'READ_ONLY',
      config: {
        diagnostic: 'uptime',
      },
    };
    expect(getStepSummary(step)).toBe('diagnostic: uptime');
  });

  it('formats CONDITION step summary with structured field and operator', () => {
    const existsStep: RunbookStepDefinition = {
      key: 'cond_exists',
      name: 'Check payload',
      type: 'CONDITION',
      riskClass: 'READ_ONLY',
      config: {
        field: 'response.data',
        operator: 'EXISTS',
      },
    };
    expect(getStepSummary(existsStep)).toBe('If response.data exists');

    const equalsStep: RunbookStepDefinition = {
      key: 'cond_equals',
      name: 'Check status code',
      type: 'CONDITION',
      riskClass: 'READ_ONLY',
      config: {
        field: 'status',
        operator: 'EQUALS',
        value: '200',
      },
    };
    expect(getStepSummary(equalsStep)).toBe('If status equals 200');
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
