import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { TypedValueInput, parseAuthoringScalar } from '@/components/automation/TypedValueInput';
import AutomationWorkspace from '@/components/automation/AutomationWorkspace';
import { RuleActionsEditor } from '@/components/automation/RuleActionsEditor';
import { conditionOperators } from '@/components/automation/RuleConditionsEditor';
import { semanticSnapshotChanges } from '@/lib/automation/diff';
import { emptySnapshot, type Rule } from '@/lib/automation/contract';
const api = vi.hoisted(() => ({ action: vi.fn(), area: vi.fn() }));
vi.mock('@/app/(app)/services/[id]/automation/actions', () => ({
  automationAction: api.action,
  getAutomationArea: api.area,
}));
const data = {
  enabled: true,
  mode: 'SHADOW',
  canPublish: true,
  canEdit: true,
  activeVersionId: null,
  activeVersion: null,
  draft: { snapshot: emptySnapshot, revision: 0 },
  aggregates: [],
  traces: [],
  policies: [],
  destinations: [],
  integrations: [],
  alerts: [],
  observations: [],
  versions: [],
  versionTotal: 0,
};
beforeEach(() => {
  localStorage.clear();
  api.action.mockReset();
  api.area.mockResolvedValue(data);
});
it('keeps blank/invalid numbers distinct from zero and invalid booleans distinct from false', () => {
  expect(parseAuthoringScalar('', 'NUMBER')).toBe('');
  expect(parseAuthoringScalar(' ', 'NUMBER')).toBe(' ');
  expect(parseAuthoringScalar('0', 'NUMBER')).toBe(0);
  expect(parseAuthoringScalar('Infinity', 'NUMBER')).toBe('Infinity');
  expect(parseAuthoringScalar('nonsense', 'BOOLEAN')).toBe('nonsense');
  expect(parseAuthoringScalar('false', 'BOOLEAN')).toBe(false);
  const change = vi.fn();
  render(<TypedValueInput type="NUMBER" value={0} label="Numeric value" onChange={change} />);
  fireEvent.change(screen.getByLabelText('Numeric value'), { target: { value: '' } });
  expect(change).toHaveBeenCalledWith('');
});
it('boolean authoring requires an explicit typed choice', () => {
  const change = vi.fn();
  render(<TypedValueInput type="BOOLEAN" value="" label="Boolean value" onChange={change} />);
  expect(screen.getByRole('alert')).toHaveTextContent('Choose true or false');
  fireEvent.change(screen.getByLabelText('Boolean value'), { target: { value: 'false' } });
  expect(change).toHaveBeenCalledWith(false);
});
it('publication awaits an autosave in flight and clears recovery only after persistence', async () => {
  let finishSave!: (value: unknown) => void;
  api.action.mockImplementation((input: { action: string }) =>
    input.action === 'save'
      ? new Promise(resolve => {
          finishSave = resolve;
        })
      : Promise.resolve({ ok: true, data: {} })
  );
  render(<AutomationWorkspace serviceId="service" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit automation' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Route production alerts' }));
  await waitFor(() =>
    expect(api.action).toHaveBeenCalledWith(expect.objectContaining({ action: 'save' }))
  );
  expect(localStorage.getItem('automation-draft:service')).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm publication' }));
  expect(api.action.mock.calls.some(([input]) => input.action === 'publish')).toBe(false);
  await act(async () => finishSave({ ok: true, data: { revision: 1 } }));
  await waitFor(() =>
    expect(api.action).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'publish', expectedRevision: 1 })
    )
  );
  expect(localStorage.getItem('automation-draft:service')).toBeNull();
});
it('loads Shadow readiness before LIVE and keeps the mode unchanged when review is cancelled', async () => {
  api.area.mockResolvedValue({
    ...data,
    activeVersionId: 'version-1',
    activeVersion: { id: 'version-1', versionNumber: 1, snapshot: emptySnapshot },
  });
  api.action.mockResolvedValue({ ok: true, data: {} });
  render(<AutomationWorkspace serviceId="service" />);
  fireEvent.change(await screen.findByLabelText('Automation mode'), { target: { value: 'LIVE' } });
  expect(await screen.findByRole('dialog')).toHaveTextContent('Shadow readiness');
  expect(api.area).toHaveBeenCalledWith('service', 'rules', 1);
  fireEvent.click(screen.getByRole('button', { name: 'Keep unchanged' }));
  expect(api.action).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Automation mode')).toHaveValue('SHADOW');
  fireEvent.change(screen.getByLabelText('Automation mode'), { target: { value: 'LIVE' } });
  fireEvent.click(await screen.findByRole('checkbox', { name: /I understand this version/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm LIVE' }));
  await waitFor(() =>
    expect(api.action).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'mode',
        mode: 'LIVE',
        expectedActiveVersionId: 'version-1',
      })
    )
  );
});
it('shows recent-field frequency/examples and authors an EVENT mapping from the suggestion', async () => {
  api.action.mockImplementation((input: { action: string }) =>
    Promise.resolve({
      ok: true,
      data:
        input.action === 'discoverRecent'
          ? [
              {
                key: 'payload_custom_details_environment',
                path: 'payload.custom_details.environment',
                value: 'stg',
                examples: ['prd', 'stg'],
                frequency: 2,
                type: 'STRING',
                unmapped: false,
                source: 'EVENT',
              },
            ]
          : { revision: 1 },
    })
  );
  render(<AutomationWorkspace serviceId="service" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Context' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Discover from recent alerts' }));
  expect(await screen.findByText('Examples: prd, stg')).toBeInTheDocument();
  expect(screen.getByText(/2 recent alerts/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Choose field' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
  await waitFor(() =>
    expect(api.action).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'save',
        snapshot: expect.objectContaining({
          fields: expect.arrayContaining([
            expect.objectContaining({
              key: 'environment',
              mappings: [{ source: 'EVENT', path: 'payload.custom_details.environment' }],
            }),
          ]),
        }),
      })
    )
  );
});

it('LIVE review cannot replace Overview data when cancelled', async () => {
  api.area.mockImplementation(async (_id: string, area: string) => ({
    ...data,
    mode: 'SHADOW',
    activeVersionId: 'version-1',
    activeVersion: { id: 'version-1', versionNumber: 1, snapshot: emptySnapshot },
    traces:
      area === 'overview'
        ? [
            {
              id: 'trace-1',
              incidentId: 'incident-1',
              mode: 'SHADOW',
              durationMs: 1,
              fallbackReason: null,
              detail: {},
            },
          ]
        : [],
  }));
  render(<AutomationWorkspace serviceId="service" />);
  expect(await screen.findByRole('link', { name: 'Incident' })).toHaveAttribute(
    'href',
    '/incidents/incident-1'
  );
  fireEvent.change(screen.getByLabelText('Automation mode'), { target: { value: 'LIVE' } });
  await screen.findByRole('dialog');
  fireEvent.click(screen.getByRole('button', { name: 'Keep unchanged' }));
  expect(screen.getByRole('link', { name: 'Incident' })).toHaveAttribute(
    'href',
    '/incidents/incident-1'
  );
});

it('limits conditions by field type and ENUM choices to published canonical values', () => {
  expect(conditionOperators('BOOLEAN')).not.toHaveProperty('IN');
  expect(conditionOperators('STRING')).not.toHaveProperty('LT');
  expect(conditionOperators('NUMBER')).toHaveProperty('LT');
  const change = vi.fn();
  render(
    <TypedValueInput
      type="ENUM"
      canonicalValues={['production', 'staging']}
      value="production"
      label="Environment"
      onChange={change}
    />
  );
  expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual([
    'Choose canonical value…',
    'production',
    'staging',
  ]);
  fireEvent.change(screen.getByLabelText('Environment'), { target: { value: 'staging' } });
  expect(change).toHaveBeenCalledWith('staging');
});

it('keeps exactly one responder route separate from optional notifications and gates missing destinations', () => {
  const change = vi.fn();
  const rule: Rule = {
    id: 'route',
    name: 'Production',
    phase: 'ROUTE',
    enabled: true,
    conditions: [],
    actions: [{ type: 'USE_SERVICE_DEFAULT' }],
  };
  render(
    <RuleActionsEditor
      rule={rule}
      fields={[]}
      policies={[]}
      destinations={[]}
      disabled={false}
      onChange={change}
    />
  );
  expect(screen.getByRole('button', { name: 'Add notification' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Remove action' })).not.toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'use escalation policy' })).toBeDisabled();
  expect(screen.queryByRole('option', { name: 'notify channel' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Responder route'), {
    target: { value: 'NO_ESCALATION' },
  });
  expect(change).toHaveBeenCalledWith([{ type: 'NO_ESCALATION' }]);
});

it('reviews actual routing and priority changes using names rather than opaque policy identifiers', () => {
  const rule: Rule = {
    id: 'route',
    name: 'Production',
    phase: 'ROUTE',
    enabled: true,
    conditions: [],
    actions: [{ type: 'USE_SERVICE_DEFAULT' }],
  };
  const changes = semanticSnapshotChanges(
    { ...emptySnapshot, rules: [rule] },
    {
      ...emptySnapshot,
      rules: [
        { ...rule, actions: [{ type: 'USE_ESCALATION_POLICY', policyId: 'opaque-policy-id' }] },
      ],
    },
    { policies: [{ id: 'opaque-policy-id', name: 'Production Primary' }] }
  );
  expect(changes).toEqual(['Production: Before: Service default → After: Production Primary']);
});
