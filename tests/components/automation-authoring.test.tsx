import type { ComponentProps } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { TypedValueInput, parseAuthoringScalar } from '@/components/automation/TypedValueInput';
import AutomationWorkspace from '@/components/automation/AutomationWorkspace';
import { RuleActionsEditor } from '@/components/automation/RuleActionsEditor';
import { conditionOperators } from '@/components/automation/RuleConditionsEditor';
import { semanticSnapshotChanges } from '@/lib/automation/diff';
import { emptySnapshot, type Rule, type Snapshot } from '@/lib/automation/contract';
import { formatHierarchicalLabel } from '@/lib/automation/discovery';
import { deriveUniqueFieldKey } from '@/components/automation/authoring/context-fields';
import { AutomationTest } from '@/components/automation/AutomationTest';
const api = vi.hoisted(() => ({ action: vi.fn(), area: vi.fn() }));
vi.mock('@/app/(app)/services/[id]/automation/actions', () => ({
  automationAction: api.action,
  getAutomationArea: api.area,
}));
const data = {
  enabled: true,
  mode: 'SHADOW' as const,
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
  canReadSensitive: true,
  unmappedCount: 0,
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
              mappings: [
                expect.objectContaining({
                  source: 'EVENT',
                  path: 'payload.custom_details.environment',
                }),
              ],
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

it('formats hierarchical labels and generates unique stable field keys without collisions', () => {
  expect(formatHierarchicalLabel('repository.name')).toBe('Repository Name');
  expect(formatHierarchicalLabel('workflow_run.name')).toBe('Workflow Run Name');
  expect(formatHierarchicalLabel('payload.custom_details.service_tier')).toBe('Service Tier');

  const keys = new Set<string>();
  const repoKey = deriveUniqueFieldKey('Repository Name', keys);
  expect(repoKey).toBe('repository_name');
  keys.add(repoKey);

  const workflowKey = deriveUniqueFieldKey('Workflow Run Name', keys);
  expect(workflowKey).toBe('workflow_run_name');
  keys.add(workflowKey);

  const duplicateRepoKey = deriveUniqueFieldKey('Repository Name', keys);
  expect(duplicateRepoKey).toBe('repository_name_2');
});

it('AutomationTest restores integration identity, shows normalized replay mode, and warns on missing provider sample', () => {
  const setIntegrationId = vi.fn();
  const setIntegrationType = vi.fn();
  const setSample = vi.fn();
  const setProviderSample = vi.fn();
  const testData = {
    ...data,
    integrations: [{ id: 'int-gh', name: 'GitHub Actions', type: 'GITHUB' }],
    alerts: [
      {
        id: 'alert-1',
        dedupKey: 'dedup-1',
        createdAt: new Date('2026-10-20T12:00:00Z'),
        integrationId: 'int-gh',
        integrationType: 'GITHUB',
        replayMode: 'NORMALIZED_ONLY' as const,
        providerSample: null,
        payload: { summary: 'CI failure', severity: 'error', source: 'github' },
      },
    ],
  };

  const { rerender } = render(
    <AutomationTest
      data={testData}
      integrationId=""
      setIntegrationId={setIntegrationId}
      setIntegrationType={setIntegrationType}
      sample="{}"
      setSample={setSample}
      providerSample="{}"
      setProviderSample={setProviderSample}
      busy={false}
      runTest={vi.fn()}
      result={null}
    />
  );

  fireEvent.change(screen.getByLabelText('Use recent alert'), { target: { value: 'alert-1' } });
  expect(setIntegrationId).toHaveBeenCalledWith('int-gh');
  expect(setIntegrationType).toHaveBeenCalledWith('GITHUB');
  expect(setProviderSample).toHaveBeenCalledWith('{}');
  expect(screen.getByText(/Normalized alert only/)).toBeInTheDocument();

  rerender(
    <AutomationTest
      data={testData}
      integrationId="int-gh"
      setIntegrationId={setIntegrationId}
      setIntegrationType={setIntegrationType}
      sample="{}"
      setSample={setSample}
      providerSample="{}"
      setProviderSample={setProviderSample}
      busy={false}
      runTest={vi.fn()}
      result={
        {
          issues: [],
          providerFieldsMissing: ['automation.workflow_id'],
          goldenResults: [],
          durationMs: 1.23,
          result: null,
        } as unknown as ComponentProps<typeof AutomationTest>['result']
      }
    />
  );

  expect(screen.getByText('Provider-only mapping unavailable')).toBeInTheDocument();
  expect(
    screen.getByText(
      /automation\.workflow_id cannot be extracted because no raw provider sample was supplied/
    )
  ).toBeInTheDocument();
});

it('disambiguates identical paths across providers and preserves exact provider source and integration', async () => {
  let savedSnapshot: Snapshot | null = null;
  api.action.mockImplementation((input: { action: string; snapshot?: Snapshot }) => {
    if (input.action === 'save') {
      savedSnapshot = input.snapshot ?? null;
      return Promise.resolve({ ok: true, data: { revision: 1 } });
    }
    return Promise.resolve({ ok: true, data: {} });
  });

  const testData = {
    ...data,
    integrations: [
      { id: 'gh-1', name: 'GitHub Integration', type: 'GITHUB' },
      { id: 'cw-1', name: 'CloudWatch Integration', type: 'CLOUDWATCH' },
    ],
    observations: [
      {
        id: 'obs-1',
        serviceId: 'service',
        integrationId: 'gh-1',
        integrationType: 'GITHUB',
        fieldKey: 'repository_name',
        sourcePath: 'repository.name',
        fieldType: 'STRING',
        count: 5,
        unmapped: false,
        lastSeenAt: '2026-10-20T00:00:00Z',
      },
      {
        id: 'obs-2',
        serviceId: 'service',
        integrationId: 'cw-1',
        integrationType: 'CLOUDWATCH',
        fieldKey: 'repository_name',
        sourcePath: 'repository.name',
        fieldType: 'STRING',
        count: 3,
        unmapped: false,
        lastSeenAt: '2026-10-20T00:00:00Z',
      },
    ],
  };

  api.area.mockResolvedValue(testData);

  render(<AutomationWorkspace serviceId="service" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Context' }));

  // Switch integration to ALL providers to see both
  const integrationSelect = await screen.findByLabelText('Integration');
  fireEvent.change(integrationSelect, { target: { value: 'ALL' } });

  // Dropdown should contain both distinct options
  const options = screen.getAllByRole('option');
  const ghOption = options.find(o => o.textContent?.includes('repository.name (GITHUB)'));
  expect(ghOption).toBeDefined();
  expect(ghOption?.getAttribute('value')).toBe('GITHUB:PROVIDER:repository.name');

  const cwOption = options.find(o => o.textContent?.includes('repository.name (CLOUDWATCH)'));
  expect(cwOption).toBeDefined();
  expect(cwOption?.getAttribute('value')).toBe('CLOUDWATCH:PROVIDER:repository.name');

  // Select the CloudWatch option
  fireEvent.change(screen.getByLabelText('Observed field'), {
    target: { value: 'CLOUDWATCH:PROVIDER:repository.name' },
  });

  fireEvent.click(screen.getByRole('button', { name: 'Add field' }));

  await waitFor(() => expect(savedSnapshot).not.toBeNull());
  expect(savedSnapshot!.fields).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        key: 'repository_name',
        mappings: [
          expect.objectContaining({
            source: 'PROVIDER',
            integrationType: 'CLOUDWATCH',
            path: 'repository.name',
          }),
        ],
      }),
    ])
  );
});

it('correctly maps manually authored paths for GitHub (PROVIDER) and Events API (EVENT)', async () => {
  let savedSnapshot: Snapshot | null = null;
  api.action.mockImplementation((input: { action: string; snapshot?: Snapshot }) => {
    if (input.action === 'save') {
      savedSnapshot = input.snapshot ?? null;
      return Promise.resolve({ ok: true, data: { revision: 1 } });
    }
    return Promise.resolve({ ok: true, data: {} });
  });

  const testData = {
    ...data,
    integrations: [{ id: 'gh-1', name: 'GitHub Integration', type: 'GITHUB' }],
  };
  api.area.mockResolvedValue(testData);

  render(<AutomationWorkspace serviceId="service-1" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Context' }));

  // 1. Author GitHub manual provider path
  const integrationSelect = await screen.findByLabelText('Integration');
  fireEvent.change(integrationSelect, { target: { value: 'GITHUB' } });

  // Open Advanced mapping
  fireEvent.click(screen.getByRole('button', { name: /Advanced mapping/i }));

  // Enter manual provider path
  fireEvent.change(screen.getByLabelText('Source path'), {
    target: { value: 'repository.full_name' },
  });
  fireEvent.change(screen.getByLabelText('Field label'), {
    target: { value: 'Repo Full Name' },
  });

  fireEvent.click(screen.getByRole('button', { name: 'Add field' }));

  await waitFor(() => expect(savedSnapshot).not.toBeNull());
  expect(savedSnapshot!.fields).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        key: 'repo_full_name',
        mappings: [
          expect.objectContaining({
            source: 'PROVIDER',
            integrationType: 'GITHUB',
            path: 'repository.full_name',
          }),
        ],
      }),
    ])
  );

  savedSnapshot = null;

  // 2. Author Events API manual event path
  fireEvent.change(screen.getByLabelText('Integration'), { target: { value: 'EVENTS_API' } });
  fireEvent.change(screen.getByLabelText('Source path'), {
    target: { value: 'payload.custom_details.environment' },
  });
  fireEvent.change(screen.getByLabelText('Field label'), {
    target: { value: 'Deployment Env' },
  });

  fireEvent.click(screen.getByRole('button', { name: 'Add field' }));

  await waitFor(() => expect(savedSnapshot).not.toBeNull());
  expect(savedSnapshot!.fields).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        key: 'deployment_env',
        mappings: [
          expect.objectContaining({
            source: 'EVENT',
            integrationType: 'EVENTS_API',
            path: 'payload.custom_details.environment',
          }),
        ],
      }),
    ])
  );

  savedSnapshot = null;

  // 3. Author All providers manual event path -> integrationType should be undefined
  fireEvent.change(screen.getByLabelText('Integration'), { target: { value: 'ALL' } });
  fireEvent.change(screen.getByLabelText('Payload source'), { target: { value: 'EVENT' } });
  fireEvent.change(screen.getByLabelText('Source path'), {
    target: { value: 'event_action' },
  });
  fireEvent.change(screen.getByLabelText('Field label'), {
    target: { value: 'Event Action' },
  });

  fireEvent.click(screen.getByRole('button', { name: 'Add field' }));

  await waitFor(() => expect(savedSnapshot).not.toBeNull());
  expect(savedSnapshot!.fields).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        key: 'event_action',
        mappings: [
          expect.objectContaining({
            source: 'EVENT',
            integrationType: undefined,
            path: 'event_action',
          }),
        ],
      }),
    ])
  );
});

it('unifies duplicate-key validation with automatic key generation (preview shows _2 without error)', async () => {
  const existingField = {
    fieldId: 'f1',
    key: 'environment',
    label: 'Environment',
    type: 'STRING' as const,
    caseSensitive: false,
    displayOnly: false,
    aliases: {},
    mappings: [{ source: 'EVENT' as const, path: 'payload.custom_details.environment' }],
  };

  const testData = {
    ...data,
    draft: {
      snapshot: {
        schemaVersion: 1,
        fields: [existingField],
        rules: [],
      },
      revision: 1,
    },
  };
  api.area.mockResolvedValue(testData);

  render(<AutomationWorkspace serviceId="service-1" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Context' }));

  // Field label defaults to "Environment"
  await screen.findByLabelText('Field label');

  // Preview should display automation.environment_2 and NOT show duplicate error
  expect(screen.getByText(/automation\.environment_2/)).toBeInTheDocument();
  expect(screen.queryByText(/already exists/i)).not.toBeInTheDocument();
});

it('changing integration dropdown reconciles and resets stale field-selection metadata', async () => {
  const testData = {
    ...data,
    integrations: [
      { id: 'gh-1', name: 'GitHub', type: 'GITHUB' },
      { id: 'cw-1', name: 'CloudWatch', type: 'CLOUDWATCH' },
    ],
    observations: [
      {
        fieldKey: 'repository_name',
        sourcePath: 'repository.name',
        fieldType: 'STRING',
        integrationType: 'GITHUB',
      },
    ],
  };
  api.area.mockResolvedValue(testData);

  render(<AutomationWorkspace serviceId="service-1" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Context' }));

  // Switch to GITHUB integration
  const integrationSelect = await screen.findByLabelText('Integration');
  fireEvent.change(integrationSelect, { target: { value: 'GITHUB' } });

  // Select the GITHUB observed field
  const observedSelect = screen.getByLabelText('Observed field') as HTMLSelectElement;
  fireEvent.change(observedSelect, { target: { value: 'GITHUB:PROVIDER:repository.name' } });
  expect(observedSelect.value).toBe('GITHUB:PROVIDER:repository.name');

  // Now change integration to CLOUDWATCH
  fireEvent.change(integrationSelect, { target: { value: 'CLOUDWATCH' } });

  // The observed field selection should be cleared/reset rather than retaining stale GITHUB metadata
  expect(observedSelect.value).toBe('');
});

it('provider switching sequence (GitHub -> All providers -> CloudWatch) preserves CloudWatch selection intact', async () => {
  const testData = {
    ...data,
    integrations: [
      { id: 'gh-1', name: 'GitHub', type: 'GITHUB' },
      { id: 'cw-1', name: 'CloudWatch', type: 'CLOUDWATCH' },
    ],
    observations: [
      {
        fieldKey: 'repository_name',
        sourcePath: 'repository.name',
        fieldType: 'STRING',
        integrationType: 'GITHUB',
      },
      {
        fieldKey: 'alarm_name',
        sourcePath: 'AlarmName',
        fieldType: 'STRING',
        integrationType: 'CLOUDWATCH',
      },
    ],
  };
  api.area.mockResolvedValue(testData);

  render(<AutomationWorkspace serviceId="service-1" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Context' }));

  const integrationSelect = (await screen.findByLabelText('Integration')) as HTMLSelectElement;
  const observedSelect = screen.getByLabelText('Observed field') as HTMLSelectElement;

  // 1. Select GitHub in integration dropdown and choose GitHub observed field
  fireEvent.change(integrationSelect, { target: { value: 'GITHUB' } });
  fireEvent.change(observedSelect, { target: { value: 'GITHUB:PROVIDER:repository.name' } });
  expect(observedSelect.value).toBe('GITHUB:PROVIDER:repository.name');

  // 2. Switch to All providers
  fireEvent.change(integrationSelect, { target: { value: 'ALL' } });

  // 3. Select CloudWatch observed field
  fireEvent.change(observedSelect, { target: { value: 'CLOUDWATCH:PROVIDER:AlarmName' } });

  // CloudWatch selection must remain intact and NOT be cleared
  expect(observedSelect.value).toBe('CLOUDWATCH:PROVIDER:AlarmName');
});

it('selecting a STRING observed field sets fieldType to STRING instead of leaving it as ENUM', async () => {
  let savedSnapshot: Snapshot | null = null;
  api.action.mockImplementation((input: { action: string; snapshot?: Snapshot }) => {
    if (input.action === 'save') {
      savedSnapshot = input.snapshot ?? null;
      return Promise.resolve({ ok: true, data: { revision: 1 } });
    }
    return Promise.resolve({ ok: true, data: {} });
  });

  const testData = {
    ...data,
    integrations: [{ id: 'gh-1', name: 'GitHub', type: 'GITHUB' }],
    observations: [
      {
        fieldKey: 'repository_full_name',
        sourcePath: 'repository.full_name',
        fieldType: 'STRING',
        integrationType: 'GITHUB',
      },
    ],
  };
  api.area.mockResolvedValue(testData);

  render(<AutomationWorkspace serviceId="service-1" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Context' }));

  const integrationSelect = (await screen.findByLabelText('Integration')) as HTMLSelectElement;
  fireEvent.change(integrationSelect, { target: { value: 'GITHUB' } });

  const observedSelect = screen.getByLabelText('Observed field') as HTMLSelectElement;
  fireEvent.change(observedSelect, { target: { value: 'GITHUB:PROVIDER:repository.full_name' } });

  // Field type select should now be STRING, NOT ENUM
  const typeSelect = screen.getByLabelText('Treat as') as HTMLSelectElement;
  expect(typeSelect.value).toBe('STRING');

  fireEvent.click(screen.getByRole('button', { name: 'Add field' }));

  await waitFor(() => expect(savedSnapshot).not.toBeNull());
  const addedField = savedSnapshot!.fields.find(f => f.key === 'repository_full_name');
  expect(addedField).toBeDefined();
  expect(addedField?.type).toBe('STRING');
  // STRING field must not have allowedValues injected
  expect(addedField).not.toHaveProperty('allowedValues');
});

it('provenance resolves accurately: root event_action as EVENT, provider payload.* as PROVIDER, and respects source selector', async () => {
  let savedSnapshot: Snapshot | null = null;
  api.action.mockImplementation((input: { action: string; snapshot?: Snapshot }) => {
    if (input.action === 'save') {
      savedSnapshot = input.snapshot ?? null;
      return Promise.resolve({ ok: true, data: { revision: 1 } });
    }
    return Promise.resolve({ ok: true, data: {} });
  });

  const testData = {
    ...data,
    integrations: [{ id: 'gh-1', name: 'GitHub', type: 'GITHUB' }],
  };
  api.area.mockResolvedValue(testData);

  render(<AutomationWorkspace serviceId="service-1" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Context' }));

  // 1. Author root field `event_action` for EVENTS_API -> should be saved as EVENT
  const integrationSelect = await screen.findByLabelText('Integration');
  fireEvent.change(integrationSelect, { target: { value: 'EVENTS_API' } });

  fireEvent.click(screen.getByRole('button', { name: /Advanced mapping/i }));
  fireEvent.change(screen.getByLabelText('Source path'), { target: { value: 'event_action' } });
  fireEvent.change(screen.getByLabelText('Field label'), { target: { value: 'Event Action' } });

  fireEvent.click(screen.getByRole('button', { name: 'Add field' }));

  await waitFor(() => expect(savedSnapshot).not.toBeNull());
  const actionField = savedSnapshot!.fields.find(f => f.key === 'event_action');
  expect(actionField?.mappings[0]).toMatchObject({
    source: 'EVENT',
    path: 'event_action',
  });

  savedSnapshot = null;

  // 2. Author provider payload with `payload.workflow_run.id` for GITHUB -> should be saved as PROVIDER
  fireEvent.change(integrationSelect, { target: { value: 'GITHUB' } });
  fireEvent.change(screen.getByLabelText('Source path'), {
    target: { value: 'payload.workflow_run.id' },
  });
  fireEvent.change(screen.getByLabelText('Field label'), { target: { value: 'Workflow Run ID' } });

  fireEvent.click(screen.getByRole('button', { name: 'Add field' }));

  await waitFor(() => expect(savedSnapshot).not.toBeNull());
  const workflowField = savedSnapshot!.fields.find(f => f.key === 'workflow_run_id');
  expect(workflowField?.mappings[0]).toMatchObject({
    source: 'PROVIDER',
    integrationType: 'GITHUB',
    path: 'payload.workflow_run.id',
  });

  savedSnapshot = null;

  // 3. User explicitly overrides Payload source dropdown to EVENT on GITHUB integration
  fireEvent.change(screen.getByLabelText('Payload source'), { target: { value: 'EVENT' } });
  fireEvent.change(screen.getByLabelText('Source path'), {
    target: { value: 'custom.event.metric' },
  });
  fireEvent.change(screen.getByLabelText('Field label'), { target: { value: 'Custom Metric' } });

  fireEvent.click(screen.getByRole('button', { name: 'Add field' }));

  await waitFor(() => expect(savedSnapshot).not.toBeNull());
  const customField = savedSnapshot!.fields.find(f => f.key === 'custom_metric');
  expect(customField?.mappings[0]).toMatchObject({
    source: 'EVENT',
    path: 'custom.event.metric',
  });
});

it('clearing a selected observation and manually entering another path ensures no stale source or integration survives', async () => {
  let savedSnapshot: Snapshot | null = null;
  api.action.mockImplementation((input: { action: string; snapshot?: Snapshot }) => {
    if (input.action === 'save') {
      savedSnapshot = input.snapshot ?? null;
      return Promise.resolve({ ok: true, data: { revision: 1 } });
    }
    return Promise.resolve({ ok: true, data: {} });
  });

  const testData = {
    ...data,
    integrations: [
      { id: 'gh-1', name: 'GitHub Integration', type: 'GITHUB' },
      { id: 'cw-1', name: 'CloudWatch Integration', type: 'CLOUDWATCH' },
    ],
    observations: [
      {
        id: 'obs-1',
        serviceId: 'service-1',
        integrationId: 'gh-1',
        integrationType: 'GITHUB',
        fieldKey: 'repository_name',
        sourcePath: 'repository.name',
        fieldType: 'STRING',
        count: 5,
        unmapped: false,
        lastSeenAt: '2026-10-20T00:00:00Z',
      },
    ],
  };
  api.area.mockResolvedValue(testData);

  render(<AutomationWorkspace serviceId="service-1" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Context' }));

  // 1. Select the GitHub observation
  const integrationSelect = (await screen.findByLabelText('Integration')) as HTMLSelectElement;
  fireEvent.change(integrationSelect, { target: { value: 'GITHUB' } });
  const observedSelect = (await screen.findByLabelText('Observed field')) as HTMLSelectElement;
  fireEvent.change(observedSelect, { target: { value: 'GITHUB:PROVIDER:repository.name' } });
  expect(observedSelect.value).toBe('GITHUB:PROVIDER:repository.name');

  // 2. Clear the selected observation ("Choose field…")
  fireEvent.change(observedSelect, { target: { value: '' } });
  expect(observedSelect.value).toBe('');

  // 3. Open Advanced mapping and manually enter a path for CLOUDWATCH
  fireEvent.change(integrationSelect, { target: { value: 'CLOUDWATCH' } });

  fireEvent.click(screen.getByRole('button', { name: /Advanced mapping/i }));
  fireEvent.change(screen.getByLabelText('Payload source'), { target: { value: 'EVENT' } });
  fireEvent.change(screen.getByLabelText('Source path'), {
    target: { value: 'custom.event.metric' },
  });
  fireEvent.change(screen.getByLabelText('Field label'), {
    target: { value: 'Custom Metric' },
  });

  fireEvent.click(screen.getByRole('button', { name: 'Add field' }));

  await waitFor(() => expect(savedSnapshot).not.toBeNull());
  const customField = savedSnapshot!.fields.find(f => f.key === 'custom_metric');
  expect(customField?.mappings[0]).toMatchObject({
    source: 'EVENT',
    integrationType: 'CLOUDWATCH',
    path: 'custom.event.metric',
  });
  // Ensure no stale GITHUB or PROVIDER from step 1 survived
  expect(customField?.mappings[0].integrationType).not.toBe('GITHUB');
  expect(customField?.mappings[0].source).not.toBe('PROVIDER');
});

it('presents recent-alert discoveries as integration-agnostic and saves them without provider scoping', async () => {
  let savedSnapshot: Snapshot | null = null;
  api.action.mockImplementation((input: { action: string; snapshot?: Snapshot }) => {
    if (input.action === 'discoverRecent') {
      return Promise.resolve({
        ok: true,
        data: [
          {
            key: 'status',
            path: 'payload.status',
            value: 'firing',
            examples: ['firing', 'resolved'],
            frequency: 4,
            type: 'STRING',
            unmapped: false,
          },
        ],
      });
    }
    if (input.action === 'save') {
      savedSnapshot = input.snapshot ?? null;
      return Promise.resolve({ ok: true, data: { revision: 1 } });
    }
    return Promise.resolve({ ok: true, data: {} });
  });

  const testData = {
    ...data,
    integrations: [{ id: 'gh-1', name: 'GitHub Integration', type: 'GITHUB' }],
  };
  api.area.mockResolvedValue(testData);

  render(<AutomationWorkspace serviceId="service-1" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Context' }));

  // Switch to GITHUB integration before discovering
  const integrationSelect = await screen.findByLabelText('Integration');
  fireEvent.change(integrationSelect, { target: { value: 'GITHUB' } });

  // Trigger recent discovery while viewing GITHUB
  fireEvent.click(screen.getByRole('button', { name: 'Discover from recent alerts' }));
  expect(await screen.findByText('Examples: firing, resolved')).toBeInTheDocument();

  // Suggestion card should not be scoped to GITHUB
  expect(screen.queryByText(/payload\.status · STRING · GITHUB/)).not.toBeInTheDocument();
  expect(screen.getByText(/payload\.status · STRING · EVENT/)).toBeInTheDocument();

  // Click choose field and add field
  fireEvent.click(screen.getByRole('button', { name: 'Choose field' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add field' }));

  await waitFor(() => expect(savedSnapshot).not.toBeNull());
  const statusField = savedSnapshot!.fields.find(f => f.key === 'status');
  expect(statusField).toBeDefined();
  expect(statusField?.mappings[0]).toMatchObject({
    source: 'EVENT',
    path: 'payload.status',
  });
  // Mapping must NOT be stamped with GITHUB
  expect(statusField?.mappings[0].integrationType).toBeUndefined();
});

it('disambiguates identical paths between normalized events and provider webhooks without cross-misclassification', async () => {
  let savedSnapshot: Snapshot | null = null;
  api.action.mockImplementation((input: { action: string; snapshot?: Snapshot }) => {
    if (input.action === 'discoverRecent') {
      return Promise.resolve({
        ok: true,
        data: [
          {
            key: 'status',
            path: 'status',
            value: 'open',
            examples: ['open', 'closed'],
            frequency: 3,
            type: 'STRING',
            unmapped: false,
          },
        ],
      });
    }
    if (input.action === 'save') {
      savedSnapshot = input.snapshot ?? null;
      return Promise.resolve({ ok: true, data: { revision: 1 } });
    }
    return Promise.resolve({ ok: true, data: {} });
  });

  const testData = {
    ...data,
    integrations: [{ id: 'gh-1', name: 'GitHub Integration', type: 'GITHUB' }],
    observations: [
      {
        id: 'obs-status-gh',
        serviceId: 'service-1',
        integrationId: 'gh-1',
        integrationType: 'GITHUB',
        fieldKey: 'status',
        sourcePath: 'status',
        fieldType: 'STRING',
        count: 5,
        unmapped: false,
        lastSeenAt: '2026-10-20T00:00:00Z',
      },
    ],
  };
  api.area.mockResolvedValue(testData);

  render(<AutomationWorkspace serviceId="service-1" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Context' }));

  // Discover recent alerts so both normalized 'status' and provider 'status' exist
  fireEvent.click(await screen.findByRole('button', { name: 'Discover from recent alerts' }));
  expect(await screen.findByText('Examples: open, closed')).toBeInTheDocument();

  // Switch to All providers to view both options
  const integrationSelect = screen.getByLabelText('Integration');
  fireEvent.change(integrationSelect, { target: { value: 'ALL' } });

  const options = screen.getAllByRole('option');
  const ghOption = options.find(o => o.getAttribute('value') === 'GITHUB:PROVIDER:status');
  const eventOption = options.find(o => o.getAttribute('value') === 'ALL:EVENT:status');

  expect(ghOption).toBeDefined();
  expect(eventOption).toBeDefined();

  // Select the GitHub provider observation
  const observedSelect = screen.getByLabelText('Observed field');
  fireEvent.change(observedSelect, { target: { value: 'GITHUB:PROVIDER:status' } });

  fireEvent.click(screen.getByRole('button', { name: 'Add field' }));

  await waitFor(() => expect(savedSnapshot).not.toBeNull());
  const ghField = savedSnapshot!.fields.find(f => f.key === 'status');
  expect(ghField?.mappings[0]).toMatchObject({
    source: 'PROVIDER',
    integrationType: 'GITHUB',
    path: 'status',
  });

  savedSnapshot = null;

  // Now select the normalized event suggestion
  fireEvent.change(observedSelect, { target: { value: 'ALL:EVENT:status' } });
  fireEvent.change(screen.getByLabelText('Field label'), { target: { value: 'Event Status' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add field' }));

  await waitFor(() => expect(savedSnapshot).not.toBeNull());
  const eventField = savedSnapshot!.fields.find(f => f.key === 'event_status');
  expect(eventField?.mappings[0]).toMatchObject({
    source: 'EVENT',
    path: 'status',
  });
  expect(eventField?.mappings[0].integrationType).toBeUndefined();
});

it('does not coerce an unmapped provider observation into EVENT when an existing mapping shares the path', async () => {
  let savedSnapshot: Snapshot | null = null;
  api.action.mockImplementation((input: { action: string; snapshot?: Snapshot }) => {
    if (input.action === 'save') {
      savedSnapshot = input.snapshot ?? null;
      return Promise.resolve({ ok: true, data: { revision: 1 } });
    }
    return Promise.resolve({ ok: true, data: {} });
  });

  const testData = {
    ...data,
    draft: {
      snapshot: {
        ...emptySnapshot,
        fields: [
          {
            fieldId: 'fld-event-status',
            key: 'event_status',
            label: 'Event Status',
            type: 'STRING' as const,
            mappings: [
              {
                path: 'status',
                source: 'EVENT' as const,
              },
            ],
            caseSensitive: false,
            aliases: {},
          },
        ],
      },
      revision: 1,
    },
    integrations: [{ id: 'gh-1', name: 'GitHub Integration', type: 'GITHUB' }],
    observations: [
      {
        id: 'obs-status-provider',
        serviceId: 'service-1',
        integrationId: 'gh-1',
        integrationType: 'GITHUB',
        fieldKey: 'status',
        sourcePath: 'status',
        source: 'PROVIDER',
        fieldType: 'STRING',
        count: 7,
        unmapped: false,
        lastSeenAt: '2026-10-21T00:00:00Z',
      },
    ],
  };
  api.area.mockResolvedValue(testData);

  render(<AutomationWorkspace serviceId="service-1" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Context' }));

  // Switch to GITHUB integration
  const integrationSelect = await screen.findByLabelText('Integration');
  fireEvent.change(integrationSelect, { target: { value: 'GITHUB' } });

  // Observed field select should contain GITHUB:PROVIDER:status, NOT GITHUB:EVENT:status
  const observedSelect = screen.getByLabelText('Observed field');
  const options = screen.getAllByRole('option');
  const providerOption = options.find(o => o.getAttribute('value') === 'GITHUB:PROVIDER:status');
  expect(providerOption).toBeDefined();
  expect(providerOption).toHaveTextContent('Status — status (GITHUB)');
  expect(options.some(o => o.getAttribute('value') === 'GITHUB:EVENT:status')).toBe(false);

  // Select the provider observation and add it
  fireEvent.change(observedSelect, { target: { value: 'GITHUB:PROVIDER:status' } });
  fireEvent.change(screen.getByLabelText('Field label'), { target: { value: 'GitHub Status' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add field' }));

  await waitFor(() => expect(savedSnapshot).not.toBeNull());
  const newField = savedSnapshot!.fields.find(f => f.key === 'github_status');
  expect(newField).toBeDefined();
  expect(newField?.mappings[0]).toMatchObject({
    source: 'PROVIDER',
    integrationType: 'GITHUB',
    path: 'status',
  });
});

it('treats legacy observations without recorded source as integration-defaulted rather than guessing from existing mappings', async () => {
  const testData = {
    ...data,
    draft: {
      snapshot: {
        ...emptySnapshot,
        fields: [
          {
            fieldId: 'fld-status',
            key: 'status',
            label: 'Status',
            type: 'STRING' as const,
            mappings: [
              {
                path: 'status',
                source: 'EVENT' as const,
              },
            ],
            caseSensitive: false,
            aliases: {},
          },
        ],
      },
      revision: 1,
    },
    integrations: [{ id: 'gh-1', name: 'GitHub Integration', type: 'GITHUB' }],
    observations: [
      {
        id: 'obs-status-legacy',
        serviceId: 'service-1',
        integrationId: 'gh-1',
        integrationType: 'GITHUB',
        fieldKey: 'status',
        sourcePath: 'status',
        source: null,
        fieldType: 'STRING',
        count: 2,
        unmapped: false,
        lastSeenAt: '2026-10-21T00:00:00Z',
      },
    ],
  };
  api.area.mockResolvedValue(testData);

  render(<AutomationWorkspace serviceId="service-1" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Context' }));

  const integrationSelect = await screen.findByLabelText('Integration');
  fireEvent.change(integrationSelect, { target: { value: 'GITHUB' } });

  const options = screen.getAllByRole('option');
  // Legacy GITHUB observation without recorded source defaults to PROVIDER by integration, not guessed as EVENT from existing mapping
  const legacyOption = options.find(o => o.getAttribute('value') === 'GITHUB:PROVIDER:status');
  expect(legacyOption).toBeDefined();
  expect(legacyOption).toHaveTextContent('Status — status (GITHUB)');
  expect(options.some(o => o.getAttribute('value') === 'GITHUB:EVENT:status')).toBe(false);
});

it('disambiguates persisted observations with identical field keys, paths, and values across EVENT and PROVIDER sources', async () => {
  const testData = {
    ...data,
    integrations: [{ id: 'gh-1', name: 'GitHub Integration', type: 'GITHUB' }],
    observations: [
      {
        id: 'obs-event-status',
        serviceId: 'service-1',
        integrationId: 'events-1',
        integrationType: 'EVENTS_API',
        fieldKey: 'status',
        sourcePath: 'status',
        rawValuePreview: 'open',
        source: 'EVENT',
        fieldType: 'STRING',
        count: 5,
        unmapped: false,
        lastSeenAt: '2026-10-21T00:00:00Z',
      },
      {
        id: 'obs-provider-status',
        serviceId: 'service-1',
        integrationId: 'gh-1',
        integrationType: 'GITHUB',
        fieldKey: 'status',
        sourcePath: 'status',
        rawValuePreview: 'open',
        source: 'PROVIDER',
        fieldType: 'STRING',
        count: 5,
        unmapped: false,
        lastSeenAt: '2026-10-21T00:00:00Z',
      },
    ],
  };
  api.area.mockResolvedValue(testData);

  render(<AutomationWorkspace serviceId="service-1" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Context' }));

  // Switch to ALL integrations to view both
  const integrationSelect = await screen.findByLabelText('Integration');
  fireEvent.change(integrationSelect, { target: { value: 'ALL' } });

  const options = screen.getAllByRole('option');
  const eventOption = options.find(o => o.getAttribute('value') === 'EVENTS_API:EVENT:status');
  const providerOption = options.find(o => o.getAttribute('value') === 'GITHUB:PROVIDER:status');

  expect(eventOption).toBeDefined();
  expect(providerOption).toBeDefined();
  expect(eventOption).toHaveTextContent('Status — status (EVENTS_API)');
  expect(providerOption).toHaveTextContent('Status — status (GITHUB)');
});
