import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import AutomationWorkspace from '@/components/automation/AutomationWorkspace';
import { AutomationReviewDialog } from '@/components/automation/AutomationReviewDialog';
import { RemoveFieldDialog } from '@/components/automation/workspace/RemoveFieldDialog';
import { applyAutomationTemplate } from '@/components/automation/workspace/templates';
import { sumShadowAggregates } from '@/components/automation/workspace/shadow-counts';
import { emptySnapshot, type Field, type Rule, type Snapshot } from '@/lib/automation/contract';

const api = vi.hoisted(() => ({ action: vi.fn(), area: vi.fn() }));
vi.mock('@/app/(app)/services/[id]/automation/actions', () => ({
  automationAction: api.action,
  getAutomationArea: api.area,
  getAutomationVersionSnapshot: vi.fn(),
}));

const base = {
  enabled: true,
  mode: 'SHADOW',
  canPublish: true,
  canEdit: true,
  canReadSensitive: true,
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
  unmappedCount: 0,
};

const brokenRule: Rule = {
  id: 'broken',
  name: 'Broken routing',
  phase: 'ROUTE',
  enabled: true,
  conditions: [{ fieldKey: 'missing_field', operator: 'EQ', value: 'x' }],
  actions: [{ type: 'USE_SERVICE_DEFAULT' }],
};

beforeEach(() => {
  localStorage.clear();
  api.action.mockReset();
  api.area.mockReset();
  api.area.mockResolvedValue(base);
});

it('summarises blocking issues, explains the disabled Publish action and jumps to the rule', async () => {
  api.area.mockResolvedValue({
    ...base,
    draft: { snapshot: { ...emptySnapshot, rules: [brokenRule] }, revision: 3 },
  });
  render(<AutomationWorkspace serviceId="service" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Rules' }));
  await screen.findByRole('button', { name: 'Configure Broken routing' });
  expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Publish' })).toHaveAccessibleDescription(
    'Fix 1 blocking issue before publishing.'
  );
  fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
  const summary = await screen.findByRole('region', { name: /1 blocking issue prevents/ });
  expect(summary).toHaveTextContent('Unknown field missing_field');
  fireEvent.click(within(summary).getByRole('button', { name: 'Open rule Broken routing' }));
  const configure = await screen.findByRole('button', { name: 'Configure Broken routing' });
  expect(configure).toHaveAttribute('aria-expanded', 'true');
  await waitFor(() => expect(configure).toHaveFocus());
});

it('confirms the consequences before turning automation off and keeps the mode when cancelled', async () => {
  api.action.mockResolvedValue({ ok: true, data: {} });
  render(<AutomationWorkspace serviceId="service" />);
  const mode = await screen.findByLabelText('Automation mode');
  fireEvent.change(mode, { target: { value: 'DISABLED' } });
  const dialog = await screen.findByRole('alertdialog');
  expect(dialog).toHaveTextContent('Turn off automation for this service?');
  expect(dialog).toHaveTextContent('Existing incidents keep their pinned routing decisions.');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Keep SHADOW' }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  expect(api.action).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Automation mode')).toHaveValue('SHADOW');
  fireEvent.change(screen.getByLabelText('Automation mode'), { target: { value: 'DISABLED' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Turn off automation' }));
  await waitFor(() =>
    expect(api.action).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'mode', mode: 'DISABLED', expectedActiveVersionId: null })
    )
  );
  expect(await screen.findByText('Automation mode set to DISABLED.')).toBeInTheDocument();
});

it('switches to SHADOW immediately without a confirmation step', async () => {
  api.area.mockResolvedValue({ ...base, mode: 'DISABLED' });
  api.action.mockResolvedValue({ ok: true, data: {} });
  render(<AutomationWorkspace serviceId="service" />);
  fireEvent.change(await screen.findByLabelText('Automation mode'), {
    target: { value: 'SHADOW' },
  });
  await waitFor(() =>
    expect(api.action).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'mode', mode: 'SHADOW' })
    )
  );
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
});

it('explains read-only access instead of silently hiding publish controls', async () => {
  api.area.mockResolvedValue({ ...base, canPublish: false, canEdit: false });
  render(<AutomationWorkspace serviceId="service" />);
  expect(
    await screen.findByText('Only administrators can publish or change the mode.')
  ).toBeInTheDocument();
  expect(screen.getByText(/Read only/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Automation mode')).not.toBeInTheDocument();
});

it('keeps the header and section navigation stable with one heading named Automation', async () => {
  render(<AutomationWorkspace serviceId="service" />);
  const region = await screen.findByRole('region', { name: 'Service automation' });
  await screen.findByRole('button', { name: 'Edit automation' });
  expect(within(region).getAllByRole('heading', { name: /Automation/ })).toHaveLength(1);
  expect(within(region).getByText(/Version — · Saved · Global ON/)).toBeInTheDocument();
  const nav = within(region).getByRole('navigation', { name: 'Automation sections' });
  expect(
    within(nav)
      .getAllByRole('button')
      .map(button => button.textContent)
  ).toEqual(['Overview', 'Context', 'Rules', 'Test', 'Activity']);
  expect(within(nav).getByRole('button', { name: 'Overview' })).toHaveAttribute(
    'aria-current',
    'true'
  );
});

it('shows a retry path when a section cannot load', async () => {
  api.area.mockRejectedValueOnce(new Error('Network down')).mockResolvedValue(base);
  render(<AutomationWorkspace serviceId="service" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Network down');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('button', { name: 'Edit automation' })).toBeInTheDocument();
});

it('describes restores accurately and states why LIVE confirmation is blocked', () => {
  const props = {
    snapshot: emptySnapshot,
    before: emptySnapshot,
    version: 2,
    enabled: true,
    busy: false,
    onCancel: vi.fn(),
    onConfirm: vi.fn(),
  };
  const { rerender } = render(<AutomationReviewDialog {...props} action="restore" />);
  expect(screen.getByRole('dialog')).toHaveTextContent(
    'Publish the selected version again as a new immutable version.'
  );
  expect(screen.getByRole('button', { name: 'Confirm publication' })).toBeEnabled();
  rerender(
    <AutomationReviewDialog
      {...props}
      action="LIVE"
      counts={{ evaluated: 0, routes: 0, priorities: 0, skips: 0, errors: 0 }}
    />
  );
  const confirm = screen.getByRole('button', { name: 'Confirm LIVE' });
  expect(confirm).toBeDisabled();
  expect(confirm).toHaveAccessibleDescription(
    'Acknowledge the missing Shadow evidence to continue.'
  );
  fireEvent.click(screen.getByRole('checkbox', { name: /I understand this version/ }));
  expect(confirm).toBeEnabled();
});

it('only offers field removal when no rule references the field', () => {
  const field: Field = {
    fieldId: 'f1',
    key: 'missing_field',
    label: 'Region',
    type: 'STRING',
    caseSensitive: false,
    aliases: {},
    mappings: [{ source: 'EVENT', path: 'payload.region' }],
  };
  const onConfirm = vi.fn();
  const onViewRules = vi.fn();
  const { rerender } = render(
    <RemoveFieldDialog
      field={field}
      rules={[brokenRule]}
      onCancel={vi.fn()}
      onViewRules={onViewRules}
      onConfirm={onConfirm}
    />
  );
  expect(screen.getByRole('alertdialog')).toHaveTextContent('Region is used by 1 rule.');
  expect(screen.queryByRole('button', { name: 'Confirm field removal' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'View affected rules' }));
  expect(onViewRules).toHaveBeenCalledWith(['broken']);
  rerender(
    <RemoveFieldDialog
      field={field}
      rules={[]}
      onCancel={vi.fn()}
      onViewRules={onViewRules}
      onConfirm={onConfirm}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Confirm field removal' }));
  expect(onConfirm).toHaveBeenCalledWith(field);
});

it('deleting a referenced field from Context area and clicking View affected rules switches to Rules area and closes dialog', async () => {
  const field: Field = {
    fieldId: 'f1',
    key: 'missing_field',
    label: 'Region',
    type: 'STRING',
    caseSensitive: false,
    aliases: {},
    mappings: [{ source: 'EVENT', path: 'payload.region' }],
  };
  api.area.mockResolvedValue({
    ...base,
    draft: { snapshot: { ...emptySnapshot, fields: [field], rules: [brokenRule] }, revision: 1 },
  });
  render(<AutomationWorkspace serviceId="service" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Context' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Remove field' }));
  const dialog = await screen.findByRole('alertdialog');
  expect(dialog).toHaveTextContent('Region is used by 1 rule.');
  fireEvent.click(screen.getByRole('button', { name: 'View affected rules' }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  const configure = await screen.findByRole('button', { name: 'Configure Broken routing' });
  expect(configure).toHaveAttribute('aria-expanded', 'true');
});

it('applies starter templates without clobbering incompatible or existing ENUM fields', () => {
  const conflicting: Snapshot = {
    ...emptySnapshot,
    fields: [
      {
        fieldId: 'env',
        key: 'environment',
        label: 'Environment',
        type: 'STRING',
        caseSensitive: false,
        aliases: {},
        mappings: [],
      },
    ],
  };
  expect(applyAutomationTemplate(conflicting, 'production')).toEqual({
    error:
      'This template conflicts with an existing context field type. Start from scratch or edit the field first.',
  });
  const enumDraft: Snapshot = {
    ...emptySnapshot,
    fields: [
      {
        fieldId: 'env',
        key: 'environment',
        label: 'Environment',
        type: 'ENUM',
        caseSensitive: false,
        allowedValues: ['PRODUCTION', 'staging'],
        aliases: {},
        mappings: [],
      },
    ],
  };
  const applied = applyAutomationTemplate(enumDraft, 'production');
  if (!('snapshot' in applied)) throw new Error('expected snapshot');
  expect(applied.snapshot.fields).toHaveLength(1);
  expect(applied.snapshot.rules[0]).toMatchObject({
    name: 'Production alerts',
    conditions: [{ fieldKey: 'environment', operator: 'EQ', value: 'PRODUCTION' }],
  });
  const scratch = applyAutomationTemplate(enumDraft, 'scratch');
  expect(scratch).toMatchObject({ snapshot: { rules: [], fields: enumDraft.fields } });
});

it('sums Shadow aggregates, optionally for one version only', () => {
  const row = (versionId: string, evaluated: number) => ({
    versionId,
    evaluated,
    same: evaluated - 1,
    routeDifferent: 1,
    priorityDifferent: 0,
    noEscalationDifferent: 0,
    errors: 0,
  });
  const rows = [row('v1', 5), row('v2', 3)] as unknown as Parameters<typeof sumShadowAggregates>[0];
  expect(sumShadowAggregates(rows)).toMatchObject({ evaluated: 8, same: 6, routes: 2 });
  expect(sumShadowAggregates(rows, 'v2')).toMatchObject({ evaluated: 3, routes: 1 });
  expect(sumShadowAggregates(undefined)).toBeUndefined();
});

it('rapid navigation and refreshes discard stale responses and prevent older responses from overwriting newer state', async () => {
  let resolveRules: (value: unknown) => void;
  const rulesPromise = new Promise(resolve => {
    resolveRules = resolve;
  });

  const rulesData = {
    ...base,
    draft: {
      snapshot: {
        ...emptySnapshot,
        rules: [
          {
            id: 'r-slow',
            name: 'Slow Rules Response',
            phase: 'ROUTE' as const,
            enabled: true,
            conditions: [],
            actions: [],
          },
        ],
      },
      revision: 1,
    },
  };

  const contextData = {
    ...base,
    draft: {
      snapshot: {
        ...emptySnapshot,
        fields: [
          {
            fieldId: 'f1',
            key: 'env_fast',
            label: 'Fast Context Field',
            type: 'STRING' as const,
            caseSensitive: false,
            displayOnly: false,
            aliases: {},
            mappings: [],
          },
        ],
      },
      revision: 2,
    },
  };

  api.area.mockImplementation(async (_serviceId: string, area: string) => {
    if (area === 'rules') {
      return await rulesPromise;
    }
    if (area === 'context') {
      return contextData;
    }
    return base;
  });

  render(<AutomationWorkspace serviceId="service" />);

  // Initial load completes on overview
  await screen.findByRole('button', { name: 'Overview' });

  // 1. User navigates to Rules (which is slow/delayed)
  fireEvent.click(screen.getByRole('button', { name: 'Rules' }));

  // 2. User rapidly navigates to Context (which resolves fast)
  fireEvent.click(screen.getByRole('button', { name: 'Context' }));

  // Context resolves first and fast
  await screen.findByRole('heading', { name: 'Add context field' });

  // 3. Now the older Rules response finally resolves
  resolveRules!(rulesData);

  // Wait a tick to ensure any pending promises settle
  await new Promise(r => setTimeout(r, 50));

  // The workspace should remain on Context and NOT be overwritten by the stale Rules response
  expect(screen.getByRole('heading', { name: 'Add context field' })).toBeInTheDocument();
  expect(screen.queryByText('Slow Rules Response')).not.toBeInTheDocument();
});
