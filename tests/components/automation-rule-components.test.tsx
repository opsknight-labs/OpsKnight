// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RuleLifecycleStepper } from '@/components/service/automation-rule/RuleLifecycleStepper';
import { RuleReadiness } from '@/components/service/automation-rule/RuleReadiness';
import { RuleTrigger } from '@/components/service/automation-rule/RuleTrigger';
import { RuleExecutionHistory } from '@/components/service/automation-rule/RuleExecutionHistory';
import { RulePolicyEvidence } from '@/components/service/automation-rule/RulePolicyEvidence';
import RuleConfigurationCheck from '@/components/runbooks/RuleConfigurationCheck';

afterEach(cleanup);

const lifecycle = {
  serviceId: 'svc',
  version: 3,
  readinessState: 'CONFIGURATION_VALID' as const,
  detached: false,
  enabled: true,
  mode: 'AUTOMATIC',
  eligibleAgents: 4,
  certifiedAgents: 3,
  executionCount: 2,
};

describe('automation rule page components', () => {
  it('renders the rule lifecycle list with step states', () => {
    render(<RuleLifecycleStepper {...lifecycle} />);
    const list = screen.getByRole('list', { name: 'Rule lifecycle' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map(item => item.getAttribute('data-state'))).toEqual([
      'done',
      'done',
      'done',
      'done',
    ]);
    expect(list).toHaveTextContent('Version 3 selected');
    expect(list).toHaveTextContent('3 / 4 Agents have fresh accepted policy evidence.');
  });

  it('marks detached rules as unable to activate', () => {
    render(
      <RuleLifecycleStepper
        {...lifecycle}
        detached
        enabled={false}
        readinessState="PAUSED"
        mode="SUGGESTED"
      />
    );
    expect(screen.getByText('Detached; activation unavailable', { exact: true })).toBeVisible();
    const activate = screen.getAllByRole('listitem')[2];
    expect(activate.getAttribute('data-state')).toBe('blocked');
  });

  it('groups readiness checks and links fixes for blocking items', () => {
    render(
      <RuleReadiness
        serviceId="svc"
        runbookId="rb"
        checks={[
          { code: 'NO_TRIGGER', state: 'blocked', message: 'No active trigger.' },
          { code: 'APPROVAL_REQUIRED', state: 'deferred', message: 'Approval required.' },
          { code: 'TARGET_CHECK_0', state: 'passed', message: 'Agent capable.' },
        ]}
      />
    );
    expect(screen.getByRole('heading', { name: /Blocking/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Warnings/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Passed/ })).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Fix: Enable an incident-created trigger/ })
    ).toHaveAttribute('href', '/services/svc?tab=runbooks');
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('renders trigger conditions as readable chips', () => {
    render(
      <RuleTrigger
        triggers={[
          {
            id: 't1',
            event: 'INCIDENT_CREATED',
            enabled: true,
            conditionLogic: 'OR',
            conditions: [
              { id: 'c1', field: 'incident.urgency', operator: 'EQUALS', value: 'HIGH' },
              { id: 'c2', field: 'service.name', operator: 'STARTS_WITH', value: 'api' },
            ],
          },
        ]}
      />
    );
    expect(screen.getByText('Incident created')).toBeInTheDocument();
    expect(screen.getByText('Match any')).toBeInTheDocument();
    expect(screen.getByText('Incident urgency = HIGH')).toBeInTheDocument();
    expect(screen.getByText('Service name starts with api')).toBeInTheDocument();
  });

  it('shows an empty history state and an execution table', () => {
    const { rerender } = render(<RuleExecutionHistory executions={[]} />);
    expect(screen.getByText('This rule has not run yet.')).toBeInTheDocument();
    rerender(
      <RuleExecutionHistory
        executions={[
          {
            id: 'exec1',
            status: 'SUCCEEDED',
            iso: '2026-01-01T00:00:00.000Z',
            relative: '2 hours ago',
            absolute: '2026-01-01 00:00:00 UTC',
            duration: '42s',
            incidentId: 'inc1',
            checksum: 'a'.repeat(64),
          },
        ]}
      />
    );
    const table = screen.getByRole('table', { name: 'Execution history' });
    expect(within(table).getByText('42s')).toBeInTheDocument();
    expect(within(table).getByRole('link', { name: 'Source incident' })).toHaveAttribute(
      'href',
      '/incidents/inc1'
    );
    expect(within(table).getByText('a'.repeat(12))).toBeInTheDocument();
  });

  it('renders policy evidence with agent names and pending state', () => {
    render(
      <RulePolicyEvidence
        checks={[
          {
            id: 'p1',
            status: 'PASSED',
            agent: 'edge-01',
            checked: {
              iso: '2026-01-01T00:00:00.000Z',
              relative: '1 minute ago',
              absolute: '2026-01-01 00:00:00 UTC',
            },
            pendingUntil: '2026-01-01 00:05:00 UTC',
            policyHash: 'f'.repeat(64),
            checksum: 'c'.repeat(64),
          },
          {
            id: 'p2',
            status: 'PENDING',
            agent: 'edge-02',
            checked: null,
            pendingUntil: '2026-01-01 00:05:00 UTC',
            policyHash: null,
            checksum: 'c'.repeat(64),
          },
        ]}
      />
    );
    const table = screen.getByRole('table', { name: 'Read-only policy evidence' });
    expect(within(table).getByText('edge-01')).toBeInTheDocument();
    expect(within(table).getByText('Pending until 2026-01-01 00:05:00 UTC')).toBeInTheDocument();
    expect(within(table).getByText('Not reported')).toBeInTheDocument();
  });

  it('keeps the configuration check accessible names and status output', async () => {
    const action = vi.fn(async () => ({
      state: 'BLOCKED' as const,
      checkedAt: '2026-01-01T00:00:00.000Z',
      eligibleAgents: null,
      armed: false,
      checks: [{ code: 'NO_TRIGGER', state: 'blocked' as const, message: 'No trigger.' }],
    }));
    render(<RuleConfigurationCheck action={action} />);
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Validate configuration · No execution' })
      );
    });
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('blocked: No trigger.');
    expect(status).toHaveTextContent('This check does not activate the rule');
  });
});
