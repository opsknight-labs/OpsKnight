// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TriggerConditionEditor from '@/components/service/runbooks/TriggerConditionEditor';
import ResolveOnVerifiedRecoveryToggle from '@/components/service/runbooks/ResolveOnVerifiedRecoveryToggle';
import UnattendedWritesPanel from '@/components/service/runbooks/UnattendedWritesPanel';
import MonitoringIncidentsToggle from '@/components/service/runbooks/MonitoringIncidentsToggle';
import {
  ContextInputMappingEditor,
  ContextTargetMappingEditor,
} from '@/components/service/runbooks/AutomationMappingEditors';
import {
  CONTEXT_CONDITION_WARNING,
  operatorsForContextField,
  type AutomationContextSummary,
} from '@/components/service/runbooks/context-helpers';

vi.mock('@/app/(app)/services/[id]/runbook-actions', () => ({
  authorizeUnattendedWritesAction: vi.fn(),
  revokeUnattendedWritesAction: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  unstable_rethrow: vi.fn(),
}));
afterEach(cleanup);

const context = (mode: AutomationContextSummary['mode']): AutomationContextSummary => ({
  mode,
  versionNumber: mode === 'DISABLED' ? null : 4,
  fields: [
    {
      key: 'priority',
      label: 'Priority',
      type: 'ENUM',
      caseSensitive: true,
      allowedValues: ['P1', 'P2'],
    },
    { key: 'environment', label: 'Environment', type: 'STRING', caseSensitive: false },
    { key: 'cluster', label: 'Cluster', type: 'STRING', caseSensitive: false },
    { key: 'replicas', label: 'Replicas', type: 'NUMBER', caseSensitive: false },
  ],
});

function hiddenValues(container: HTMLElement, name: string) {
  return [...container.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)].map(
    input => input.value
  );
}

describe('TriggerConditionEditor', () => {
  it('warns that automation conditions are skipped while service automation is not LIVE', () => {
    render(
      <TriggerConditionEditor
        conditions={[{ field: 'automation.environment', operator: 'EQUALS', value: 'prod' }]}
        automationContext={context('SHADOW')}
      />
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Service automation is shadow');
    expect(alert).toHaveTextContent(CONTEXT_CONDITION_WARNING);
  });

  it('does not warn when automation is LIVE or no automation condition is used', () => {
    const { unmount } = render(
      <TriggerConditionEditor
        conditions={[{ field: 'automation.environment', operator: 'EQUALS', value: 'prod' }]}
        automationContext={context('LIVE')}
      />
    );
    expect(screen.queryByText(CONTEXT_CONDITION_WARNING)).not.toBeInTheDocument();
    unmount();
    render(
      <TriggerConditionEditor
        conditions={[{ field: 'incident.urgency', operator: 'EQUALS', value: 'HIGH' }]}
        automationContext={context('DISABLED')}
      />
    );
    expect(screen.queryByText(CONTEXT_CONDITION_WARNING)).not.toBeInTheDocument();
  });

  it('offers ENUM allowed values for IN and keeps one aligned value per condition', () => {
    const { container } = render(
      <TriggerConditionEditor
        conditions={[
          { field: 'automation.priority', operator: 'IN', value: ['P1'] },
          { field: 'incident.urgency', operator: 'EXISTS', value: null },
          { field: 'automation.cluster', operator: 'IS_UNMAPPED', value: null },
        ]}
        automationContext={context('LIVE')}
      />
    );
    const group = screen.getByRole('group', { name: 'Condition 1 value' });
    const p2 = within(group).getByRole('checkbox', { name: 'P2' });
    expect(within(group).getByRole('checkbox', { name: 'P1' })).toBeChecked();
    fireEvent.click(p2);
    expect(hiddenValues(container, 'conditionField')).toEqual([
      'automation.priority',
      'incident.urgency',
      'automation.cluster',
    ]);
    expect(hiddenValues(container, 'conditionOperator')).toEqual(['IN', 'EXISTS', 'IS_UNMAPPED']);
    expect(hiddenValues(container, 'conditionValue')).toEqual(['P1, P2', '', '']);
    expect(screen.getAllByText(/use\s+“Is missing” \/ “Is unmapped”/).length).toBeGreaterThan(0);
  });

  it('flags an automation field that the active version no longer declares', () => {
    render(
      <TriggerConditionEditor
        conditions={[{ field: 'automation.region', operator: 'EQUALS', value: 'eu' }]}
        automationContext={context('LIVE')}
      />
    );
    expect(screen.getByText(/automation.region is not declared/)).toHaveTextContent(
      'configuration-invalid'
    );
  });

  it('adds and removes condition rows with labelled controls', () => {
    const { container } = render(
      <TriggerConditionEditor conditions={[]} automationContext={context('LIVE')} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add condition' }));
    expect(hiddenValues(container, 'conditionField')).toEqual(['none', 'none']);
    fireEvent.click(screen.getByRole('button', { name: 'Remove condition 2' }));
    expect(hiddenValues(container, 'conditionField')).toEqual(['none']);
  });
});

describe('operator helpers', () => {
  it('groups operators by automation field type and never offers NOT_EXISTS', () => {
    const [priority, , , replicas] = context('LIVE').fields;
    expect(operatorsForContextField(priority)).toEqual([
      'EQUALS',
      'NOT_EQUALS',
      'IN',
      'NOT_IN',
      'EXISTS',
      'IS_MISSING',
      'IS_UNMAPPED',
    ]);
    expect(operatorsForContextField(replicas)).not.toContain('CONTAINS');
    expect(operatorsForContextField({ key: 'b', label: 'B', type: 'BOOLEAN' })).toEqual([
      'EQUALS',
      'NOT_EQUALS',
      'EXISTS',
      'IS_MISSING',
      'IS_UNMAPPED',
    ]);
    expect(operatorsForContextField(undefined)).toContain('NOT_EXISTS');
  });
});

describe('MonitoringIncidentsToggle', () => {
  it('defaults off and submits the opt-in state', () => {
    const { container } = render(<MonitoringIncidentsToggle />);
    const toggle = screen.getByRole('switch', { name: 'Run on monitoring incidents' });
    expect(toggle).toHaveAccessibleDescription(/monitoring alerts never trigger/);
    expect(hiddenValues(container, 'runOnMonitoringIncidents')).toEqual(['false']);
    fireEvent.click(toggle);
    expect(hiddenValues(container, 'runOnMonitoringIncidents')).toEqual(['true']);
  });
});

describe('ContextInputMappingEditor', () => {
  it('offers only type-compatible automation fields and never maps secrets', () => {
    const { container } = render(
      <ContextInputMappingEditor
        inputs={[
          { key: 'cluster', label: 'Cluster', type: 'STRING', required: true },
          { key: 'replicas', label: 'Replicas', type: 'NUMBER', required: false },
          { key: 'token', label: 'Token', type: 'SECRET_REF', required: true },
        ]}
        contextFields={context('LIVE').fields}
        defaultValue={[{ inputKey: 'cluster', contextKey: 'cluster' }]}
      />
    );
    const replicas = screen.getByRole('combobox', { name: /Replicas/ });
    expect(
      within(replicas)
        .getAllByRole('option')
        .map(option => option.textContent)
    ).toEqual(['Configured value', 'automation.replicas (number)']);
    expect(screen.queryByRole('combobox', { name: /Token/ })).not.toBeInTheDocument();
    fireEvent.change(replicas, { target: { value: 'replicas' } });
    expect(JSON.parse(hiddenValues(container, 'contextInputMappings')[0])).toEqual([
      { inputKey: 'cluster', contextKey: 'cluster' },
      { inputKey: 'replicas', contextKey: 'replicas' },
    ]);
  });
});

describe('ContextTargetMappingEditor', () => {
  it('builds an approved value → target table', () => {
    const { container } = render(
      <ContextTargetMappingEditor
        contextFields={context('LIVE').fields}
        agents={[{ id: 'agent-1', name: 'db-host', hostname: 'db1' }]}
        pools={[{ id: 'pool-prod', name: 'Prod', mode: 'SHARED_TARGET' }]}
        defaultValue={{}}
      />
    );
    expect(JSON.parse(hiddenValues(container, 'contextTargetMappings')[0])).toEqual({
      contextKey: null,
      entries: [],
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Select target by' }), {
      target: { value: 'priority' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add approved value' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Mapping 1 value' }), {
      target: { value: 'P1' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Mapping 1 target' }), {
      target: { value: 'pool:pool-prod' },
    });
    expect(JSON.parse(hiddenValues(container, 'contextTargetMappings')[0])).toEqual({
      contextKey: 'priority',
      entries: [{ value: 'P1', agentPoolId: 'pool-prod' }],
    });
  });

  it('warns when the mapped field is no longer published', () => {
    render(
      <ContextTargetMappingEditor
        contextFields={context('LIVE').fields}
        agents={[]}
        pools={[]}
        defaultValue={{ contextKey: 'gone', entries: [] }}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('automatic execution is blocked');
  });
});

describe('ResolveOnVerifiedRecoveryToggle', () => {
  it('submits the toggle state and explains that runbook success alone never resolves', () => {
    const { container } = render(<ResolveOnVerifiedRecoveryToggle />);
    const toggle = screen.getByRole('switch', { name: 'Resolve incident on verified recovery' });
    expect(toggle).toHaveAccessibleDescription(/Runbook success alone never resolves/);
    expect(hiddenValues(container, 'resolveOnVerifiedRecovery')).toEqual(['false']);
    fireEvent.click(toggle);
    expect(hiddenValues(container, 'resolveOnVerifiedRecovery')).toEqual(['true']);
  });
});

describe('UnattendedWritesPanel', () => {
  const eligibility = {
    eligible: true,
    reasons: [],
    writeActions: [
      {
        key: 'scale',
        name: 'Scale deployment',
        type: 'KUBERNETES',
        riskClass: 'IDEMPOTENT_WRITE',
        hasVerification: true,
      },
      {
        key: 'failover',
        name: 'Fail over database',
        type: 'SCRIPT',
        riskClass: 'NON_IDEMPOTENT',
        hasVerification: true,
        alwaysRequiresApproval: true,
      },
    ],
  };

  it('lists write actions and confirms authorization for the exact pinned version', () => {
    render(
      <UnattendedWritesPanel
        serviceId="service"
        bindingId="binding"
        runbookName="Recovery"
        pinnedVersionId="version-7"
        pinnedVersionNumber={7}
        authorization={null}
        eligibility={eligibility}
        canAuthorize
      />
    );
    expect(screen.getByRole('status')).toHaveTextContent('Requires approval');
    expect(screen.getByText('Always requires approval')).toBeVisible();
    expect(screen.getAllByText(/Verification\s+present/)).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Authorize v7' }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Authorize unattended writes for v7?');
    expect(dialog).toHaveTextContent('Recovery v7 (the exact pinned version)');
    expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
  });

  it('shows authorized status with actor and time, offering revoke', () => {
    render(
      <UnattendedWritesPanel
        serviceId="service"
        bindingId="binding"
        runbookName="Recovery"
        pinnedVersionId="version-7"
        pinnedVersionNumber={7}
        authorization={{
          versionId: 'version-7',
          authorizedAtIso: '2026-10-19T10:00:00.000Z',
          authorizedAtLabel: 'Oct 19, 2026 10:00 UTC',
          authorizedBy: 'Alice Admin',
        }}
        eligibility={eligibility}
        canAuthorize
      />
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Authorized for v7 by Alice Admin at Oct 19, 2026 10:00 UTC'
    );
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Authorize v7/ })).not.toBeInTheDocument();
  });

  it('blocks authorization when a write action lacks verification', () => {
    render(
      <UnattendedWritesPanel
        serviceId="service"
        bindingId="binding"
        runbookName="Recovery"
        pinnedVersionId="version-7"
        pinnedVersionNumber={7}
        authorization={null}
        eligibility={{
          eligible: false,
          reasons: [
            'UNATTENDED_WRITE_VERIFICATION_REQUIRED: Write action "Scale deployment" (scale) has no verification step.',
          ],
          writeActions: [{ ...eligibility.writeActions[0], hasVerification: false }],
        }}
        canAuthorize
      />
    );
    expect(screen.getByText('No verification')).toBeVisible();
    expect(
      screen.getByText('Write action "Scale deployment" (scale) has no verification step.')
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: /Authorize/ })).not.toBeInTheDocument();
  });

  it('treats an authorization for another version as stale and hides controls from non-admins', () => {
    render(
      <UnattendedWritesPanel
        serviceId="service"
        bindingId="binding"
        runbookName="Recovery"
        pinnedVersionId="version-8"
        pinnedVersionNumber={8}
        authorization={{
          versionId: 'version-7',
          authorizedAtIso: '2026-10-19T10:00:00.000Z',
          authorizedAtLabel: 'Oct 19, 2026 10:00 UTC',
          authorizedBy: 'Alice Admin',
        }}
        eligibility={eligibility}
        canAuthorize={false}
      />
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'previous authorization was for a different version'
    );
    expect(
      screen.getByText('Only administrators can authorize unattended write steps.')
    ).toBeVisible();
    expect(screen.queryByText('Scale deployment')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
