import { createRef } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { AutomationRules } from '@/components/automation/AutomationRules';
import { AutomationContext } from '@/components/automation/AutomationContext';
import { RuleConditionsEditor } from '@/components/automation/RuleConditionsEditor';
import { RuleActionsEditor } from '@/components/automation/RuleActionsEditor';
import { CanonicalValuesEditor } from '@/components/automation/CanonicalValuesEditor';
import { AliasEditor } from '@/components/automation/AliasEditor';
import { TraceDetail } from '@/components/automation/TraceDetail';
import { builtinFields, type Field, type Rule, type Snapshot } from '@/lib/automation/contract';
import type { Data } from '@/components/automation/presentation-types';

vi.mock('@/app/(app)/services/[id]/automation/actions', () => ({
  automationAction: vi.fn(),
  getAutomationArea: vi.fn(),
}));

const environment: Field = {
  fieldId: 'env',
  key: 'environment',
  label: 'Environment',
  type: 'ENUM',
  caseSensitive: false,
  allowedValues: ['production', 'staging'],
  aliases: { prd: 'production' },
  mappings: [{ source: 'EVENT', path: 'payload.custom_details.environment' }],
};
const fields = [...builtinFields, environment];
const routeRule = (id: string, name: string, extra: Partial<Rule> = {}): Rule => ({
  id,
  name,
  phase: 'ROUTE',
  enabled: true,
  conditions: [{ fieldKey: 'environment', operator: 'EQ', value: 'production' }],
  actions: [{ type: 'USE_ESCALATION_POLICY', policyId: 'policy-1' }],
  ...extra,
});
const data = {
  canEdit: true,
  canReadSensitive: true,
  policies: [{ id: 'policy-1', name: 'Production Primary' }],
  destinations: [],
  integrations: [],
  observations: [],
  alerts: [],
} as unknown as Data;

function renderRules(overrides: Partial<Parameters<typeof AutomationRules>[0]> = {}) {
  const draft: Snapshot = {
    schemaVersion: 1,
    fields: [environment],
    rules: [routeRule('a', 'Production alerts'), routeRule('b', 'Staging alerts')],
  };
  const props = {
    data,
    draft,
    fields,
    ruleSearch: '',
    setRuleSearch: vi.fn(),
    ruleStateFilter: 'all',
    setRuleStateFilter: vi.fn(),
    expandedRules: new Set<string>(),
    setExpandedRules: vi.fn(),
    draggedRule: createRef<string | null>(),
    edit: vi.fn(),
    updateRule: vi.fn(),
    move: vi.fn(),
    removeRule: vi.fn(),
    mobile: false,
    createTemplate: vi.fn(),
    newRule: vi.fn(),
    issues: [],
    ...overrides,
  };
  return { props, ...render(<AutomationRules {...props} />) };
}

it('summarizes each rule as a sentence and explains first-match routing', () => {
  renderRules();
  expect(screen.getByText(/The first rule whose conditions all match/)).toBeInTheDocument();
  const row = screen.getByRole('button', { name: 'Configure Production alerts' });
  expect(row).toHaveTextContent('When Environment equals production → route to Production Primary');
  expect(screen.getByText('2 / 100 rules')).toBeInTheDocument();
});

it('reorders with keyboard arrows on the handle and announces boundaries', () => {
  const move = vi.fn();
  renderRules({ move, expandedRules: new Set(['a', 'b']) });
  fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder rule 2' }), { key: 'ArrowUp' });
  expect(move).toHaveBeenCalledWith(1, -1);
  expect(screen.getByText('Staging alerts moved to routing position 1.')).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole('button', { name: 'Move rule up' })[0]);
  expect(move).toHaveBeenLastCalledWith(0, -1);
  expect(
    screen.getByText('Production alerts is already first in routing rules.')
  ).toBeInTheDocument();
});

it('adds rules into their phase and reorders by drag and drop within a phase', () => {
  const edit = vi.fn();
  const added = routeRule('c', 'New enrichment', { phase: 'ENRICH', conditions: [] });
  const { props } = renderRules({
    edit,
    newRule: vi.fn(() => added),
    expandedRules: new Set(['a', 'b']),
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add enrichment rule' }));
  expect(edit.mock.calls[0][0].rules.map((rule: Rule) => rule.id)).toEqual(['c', 'a', 'b']);
  fireEvent.dragStart(screen.getByRole('button', { name: 'Reorder rule 2' }), {
    dataTransfer: { setData: vi.fn(), effectAllowed: '' },
  });
  expect(props.draggedRule.current).toBe('b');
  fireEvent.drop(
    screen.getByRole('button', { name: 'Configure Production alerts' }).closest('li')!
  );
  expect(edit.mock.calls[1][0].rules.map((rule: Rule) => rule.id)).toEqual(['b', 'a']);
  expect(props.draggedRule.current).toBeNull();
});

it('routes rule edits through updateRule with the rule id', () => {
  const updateRule = vi.fn();
  renderRules({ updateRule, expandedRules: new Set(['b']) });
  fireEvent.change(screen.getByLabelText('Rule name'), { target: { value: 'Staging' } });
  expect(updateRule).toHaveBeenCalledWith('b', { name: 'Staging' });
  fireEvent.click(screen.getByRole('switch', { name: 'Enabled' }));
  expect(updateRule).toHaveBeenLastCalledWith('b', { enabled: false });
});

it('shows condition limits, sentence prefixes and keeps compatible values across operators', () => {
  const onChange = vi.fn();
  const rule = routeRule('a', 'Production', {
    conditions: Array.from({ length: 20 }, () => ({
      fieldKey: 'environment',
      operator: 'EQ' as const,
      value: 'production',
    })),
  });
  render(<RuleConditionsEditor rule={rule} fields={fields} canEdit onChange={onChange} />);
  expect(screen.getByText(/20 \/ 20 conditions/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add condition' })).toBeDisabled();
  const first = screen.getByRole('group', { name: 'Condition 1' });
  expect(first).toHaveTextContent('When');
  expect(screen.getByRole('group', { name: 'Condition 2' })).toHaveTextContent('and');
  fireEvent.change(within(first).getByLabelText('Condition operator'), {
    target: { value: 'NE' },
  });
  expect(onChange.mock.calls[0][0].conditions[0]).toEqual({
    fieldKey: 'environment',
    operator: 'NE',
    value: 'production',
  });
  fireEvent.change(within(first).getByLabelText('Condition operator'), {
    target: { value: 'IN' },
  });
  expect(onChange.mock.calls[1][0].conditions[0].value).toEqual(['production']);
});

it('keeps a deleted field visible instead of silently showing another field', () => {
  const rule = routeRule('a', 'Orphan', {
    conditions: [{ fieldKey: 'deleted_field', operator: 'IS_SET' }],
  });
  render(<RuleConditionsEditor rule={rule} fields={fields} canEdit onChange={vi.fn()} />);
  expect(screen.getByLabelText('Condition field')).toHaveValue('deleted_field');
  expect(screen.getByRole('option', { name: 'deleted_field (missing field)' })).toBeInTheDocument();
});

it('explains route consequences and keeps the NO_ESCALATION warning', () => {
  const rule = routeRule('a', 'Quiet', { actions: [{ type: 'NO_ESCALATION' }] });
  render(
    <RuleActionsEditor
      rule={rule}
      fields={fields}
      policies={data.policies}
      destinations={[]}
      disabled={false}
      onChange={vi.fn()}
    />
  );
  expect(screen.getByRole('note')).toHaveTextContent(
    'No escalation stops personal paging only. Ordinary service and integration notifications still apply.'
  );
  expect(screen.getByText(/1 \/ 8 actions/)).toBeInTheDocument();
});

it('flags an unavailable escalation policy instead of displaying the first policy', () => {
  const rule = routeRule('a', 'Archived', {
    actions: [{ type: 'USE_ESCALATION_POLICY', policyId: 'archived' }],
  });
  render(
    <RuleActionsEditor
      rule={rule}
      fields={fields}
      policies={data.policies}
      destinations={[]}
      disabled={false}
      onChange={vi.fn()}
    />
  );
  expect(screen.getByLabelText('Escalation policy')).toHaveValue('archived');
  expect(screen.getByText('Choose an available escalation policy.')).toBeInTheDocument();
});

it('adds canonical choices with Enter and rejects duplicates inline', () => {
  const onChange = vi.fn();
  render(
    <CanonicalValuesEditor values={['production']} usedValues={new Set()} onChange={onChange} />
  );
  const input = screen.getByLabelText('New canonical choice');
  fireEvent.change(input, { target: { value: 'production' } });
  expect(screen.getByText('“production” is already a choice.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add choice' })).toBeDisabled();
  fireEvent.change(input, { target: { value: 'staging' } });
  fireEvent.submit(input.closest('form')!);
  expect(onChange).toHaveBeenCalledWith(['production', 'staging']);
});

it('rejects duplicate aliases inline and keeps stale alias targets visible', () => {
  render(
    <AliasEditor aliases={{ prd: 'retired' }} canonicalValues={['production']} onChange={vi.fn()} />
  );
  expect(screen.getByLabelText('Canonical value for prd')).toHaveValue('retired');
  fireEvent.change(screen.getByLabelText('New alias'), { target: { value: 'prd' } });
  expect(screen.getByText('“prd” is already mapped.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add alias' })).toBeDisabled();
});

function renderContext(overrides: Partial<Parameters<typeof AutomationContext>[0]> = {}) {
  const props = {
    data,
    draft: { schemaVersion: 1, fields: [environment], rules: [] } as Snapshot,
    contextSearch: '',
    setContextSearch: vi.fn(),
    updateField: vi.fn(),
    setDeleteField: vi.fn(),
    integrationType: 'EVENTS_API',
    setIntegrationType: vi.fn(),
    observedPath: '',
    setObservedPath: vi.fn(),
    discoveries: [],
    setDiscoveries: vi.fn(),
    fieldLabel: '',
    setFieldLabel: vi.fn(),
    fieldType: 'STRING' as const,
    setFieldType: vi.fn(),
    values: [],
    setValues: vi.fn(),
    addField: vi.fn(),
    advanced: false,
    setAdvanced: vi.fn(),
    busy: false,
    setBusy: vi.fn(),
    setError: vi.fn(),
    serviceId: 'service',
    providerSample: '{}',
    setProviderSample: vi.fn(),
    analyze: vi.fn(),
    ...overrides,
  };
  return render(<AutomationContext {...props} />);
}

it('lists context fields with type, mappings and provenance', () => {
  renderContext();
  const catalog = screen.getByRole('list', { name: 'Context field catalog' });
  const row = within(catalog).getByRole('button', { pressed: true });
  expect(row).toHaveTextContent('Environment');
  expect(row).toHaveTextContent('environment');
  expect(row).toHaveTextContent('Choice');
  expect(row).toHaveTextContent('1 mapping · 2 choices · 1 alias');
  expect(row).toHaveTextContent('Normalized event');
  expect(screen.getByText('Recognized: production, staging')).toBeInTheDocument();
});

it('validates a new field inline without changing when Add field is enabled', () => {
  renderContext({ fieldLabel: 'Environment' });
  expect(screen.getByText(/automation\.environment_2/)).toBeInTheDocument();
  expect(screen.queryByText(/already exists/i)).not.toBeInTheDocument();
  expect(
    screen.getAllByText(
      'Choose an observed field, or enter a source path under Advanced mapping.'
    )[0]
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add field' })).toBeEnabled();
});

it('never exposes or maps redacted observation values for restricted readers', () => {
  renderContext({
    data: {
      ...data,
      canReadSensitive: false,
      observations: [
        {
          id: 'o1',
          fieldKey: 'environment',
          sourcePath: 'payload.custom_details.environment',
          integrationType: 'EVENTS_API',
          rawValuePreview: '[redacted]',
          unmapped: true,
          count: 3,
        },
      ],
    } as unknown as Data,
  });
  expect(screen.getByText(/Value hidden · 3 alerts/)).toBeInTheDocument();
  expect(screen.queryByLabelText('Map [redacted]')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Discover from recent alerts' })).toBeDisabled();
});

it('shows restricted trace details without implying a service-default outcome', () => {
  render(<TraceDetail detail={{ redacted: true, shadowDifferent: true }} />);
  expect(screen.getByText(/Evaluation details are restricted/)).toBeInTheDocument();
  expect(screen.queryByText(/Service default/)).not.toBeInTheDocument();
  expect(screen.queryByText('Advanced diagnostics')).not.toBeInTheDocument();
});

it('explains per-rule evaluation steps and the first routing match', () => {
  render(
    <TraceDetail
      detail={{
        policyName: 'Production Primary',
        result: {
          matchedRule: { name: 'Production alerts' },
          outcome: { type: 'ESCALATION_POLICY', policyId: 'policy-1' },
          enrichedContext: { priority: { state: 'RECOGNIZED', value: 'P1' } },
          enrichmentRuleResults: [{ ruleName: 'Tag VIP', result: 'UNKNOWN' }],
          routingRuleResults: [
            { ruleName: 'Staging alerts', result: 'FALSE' },
            { ruleName: 'Production alerts', result: 'TRUE' },
          ],
        },
        actual: { priority: 'P3', route: 'SERVICE_DEFAULT' },
      }}
    />
  );
  expect(screen.getByText('Production Primary')).toBeInTheDocument();
  expect(screen.getByText('Final priority: P1')).toBeInTheDocument();
  expect(screen.getByText('Did not match')).toBeInTheDocument();
  expect(screen.getByText('Matched')).toBeInTheDocument();
  expect(screen.getByText('Unknown (missing or unmapped value)')).toBeInTheDocument();
  expect(screen.getByText(/selected \(first match\)/)).toBeInTheDocument();
});

it('does not crash on an empty trace detail', () => {
  render(<TraceDetail detail={null} />);
  expect(screen.getByText('Advanced diagnostics')).toBeInTheDocument();
});
