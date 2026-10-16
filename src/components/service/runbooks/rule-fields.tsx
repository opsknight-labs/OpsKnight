'use client';

import { useState } from 'react';
import type { RunbookInput } from '@prisma/client';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { FormSelect } from '@/components/runbooks/RunbookControls';
import Field from '@/components/runbooks/RunbookField';
import { requiresAgent, type RunbookRiskClass, type RunbookStepType } from '@/lib/runbooks/types';
import { minimumRiskForStep } from '@/lib/runbooks/definition';
import { parseSelectOptions } from '@/lib/runbooks/input-options';

export type InputDefinition = Pick<
  RunbookInput,
  'key' | 'label' | 'type' | 'required' | 'defaultValue' | 'description'
> & { options?: unknown };

const SENSITIVE_KEY = /password|secret|token|credential|api.?key|private.?key/i;

export function InputFields({
  definitions,
  values,
}: {
  definitions: InputDefinition[];
  values: Record<string, unknown>;
}) {
  const [entered, setEntered] = useState<Record<string, unknown>>(values);
  if (definitions.length === 0)
    return <p className="text-xs text-muted-foreground sm:col-span-2">No inputs required.</p>;
  return definitions.map(input => {
    const current = entered[input.key] ?? input.defaultValue ?? '';
    if (input.type === 'BOOLEAN') {
      return (
        <label key={input.key} className="flex items-start gap-2 rounded-md border p-3 text-sm">
          <input
            name={`input:${input.key}`}
            data-review-sensitive={SENSITIVE_KEY.test(input.key)}
            type="checkbox"
            value="true"
            checked={current === true || current === 'true'}
            onChange={event =>
              setEntered(previous => ({ ...previous, [input.key]: event.target.checked }))
            }
            className="mt-0.5 h-4 w-4"
          />
          <span>
            <span className="font-medium">{input.label}</span>
            {input.description && (
              <span className="mt-1 block text-xs text-muted-foreground">{input.description}</span>
            )}
          </span>
        </label>
      );
    }
    if (input.type === 'SELECT') {
      const options = parseSelectOptions(input.options);
      return (
        <Field key={input.key} label={`${input.label}${input.required ? ' *' : ''}`}>
          <FormSelect
            name={`input:${input.key}`}
            label={input.label}
            value={typeof current === 'string' && current ? current : undefined}
            onValueChange={value => setEntered(previous => ({ ...previous, [input.key]: value }))}
            options={options.map(option => ({ value: option, label: option }))}
          />
          {input.description && (
            <p className="text-xs text-muted-foreground">{input.description}</p>
          )}
        </Field>
      );
    }
    const displayed =
      input.type === 'SECRET_REF' && typeof current === 'string'
        ? current.replace(/^secret:\/\//, '')
        : typeof current === 'string' || typeof current === 'number'
          ? String(current)
          : '';
    return (
      <Field key={input.key} label={`${input.label}${input.required ? ' *' : ''}`}>
        <Input
          name={`input:${input.key}`}
          data-review-sensitive={input.type === 'SECRET_REF' || SENSITIVE_KEY.test(input.key)}
          type={input.type === 'NUMBER' ? 'number' : input.type === 'URL' ? 'url' : 'text'}
          step={input.type === 'NUMBER' ? 'any' : undefined}
          required={input.required}
          value={displayed}
          onChange={event =>
            setEntered(previous => ({ ...previous, [input.key]: event.target.value }))
          }
          placeholder={
            input.type === 'DURATION'
              ? '30s, 5m, or 1h'
              : input.type === 'SECRET_REF'
                ? 'Secret name'
                : undefined
          }
          aria-describedby={input.description ? `input-help-${input.key}` : undefined}
        />
        {input.description && (
          <p id={`input-help-${input.key}`} className="text-xs text-muted-foreground">
            {input.description}
          </p>
        )}
      </Field>
    );
  });
}

export function InputSummary({
  definitions,
  values,
}: {
  definitions: InputDefinition[];
  values: Record<string, unknown>;
}) {
  if (definitions.length === 0)
    return <p className="text-xs text-muted-foreground">No inputs configured.</p>;
  return (
    <dl className="grid gap-2 sm:grid-cols-2">
      {definitions.map(input => (
        <div key={input.key} className="rounded-md border bg-muted/20 px-3 py-2 text-xs">
          <dt className="font-medium text-foreground">{input.label}</dt>
          <dd className="mt-0.5 break-words text-muted-foreground">
            {input.type === 'SECRET_REF' && (values[input.key] ?? input.defaultValue)
              ? 'Configured secret reference'
              : String(values[input.key] ?? input.defaultValue ?? 'Not set')}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export const TRIGGER_FIELDS = [
  ['incident.urgency', 'Incident urgency'],
  ['incident.priority', 'Incident priority'],
  ['incident.status', 'Incident status'],
  ['incident.title', 'Incident title'],
  ['incident.description', 'Incident description'],
  ['incident.tags', 'Incident tags'],
  ['service.name', 'Service name'],
  ['service.teamId', 'Service team'],
] as const;

export function TriggerConditionRow({
  field = '',
  operator = 'EQUALS',
  value = '',
  index,
  onRemove,
}: {
  field?: string;
  operator?: string;
  value?: unknown;
  index?: number;
  onRemove?: () => void;
}) {
  const knownField = TRIGGER_FIELDS.some(([candidate]) => candidate === field);
  const displayedValue = Array.isArray(value)
    ? value.join(', ')
    : value === null
      ? ''
      : String(value);
  return (
    <div className="grid items-center gap-2 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_2.25rem]">
      <FormSelect
        name="conditionField"
        label="Trigger condition field"
        defaultValue={field || 'none'}
        options={[
          { value: 'none', label: 'No additional condition' },
          ...(field && !knownField ? [{ value: field, label: field }] : []),
          ...TRIGGER_FIELDS.map(([value, label]) => ({ value, label })),
        ]}
      />
      <FormSelect
        name="conditionOperator"
        label="Trigger condition operator"
        defaultValue={operator}
        options={[
          { value: 'EQUALS', label: 'Equals' },
          { value: 'NOT_EQUALS', label: 'Does not equal' },
          { value: 'CONTAINS', label: 'Contains' },
          { value: 'STARTS_WITH', label: 'Starts with' },
          { value: 'IN', label: 'Is one of' },
          { value: 'NOT_IN', label: 'Is not one of' },
          { value: 'EXISTS', label: 'Exists' },
          { value: 'NOT_EXISTS', label: 'Does not exist' },
        ]}
      />
      <Input
        name="conditionValue"
        aria-label="Trigger condition value"
        defaultValue={displayedValue}
        placeholder="Match value"
      />
      {onRemove ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 justify-self-end text-muted-foreground hover:text-destructive"
          aria-label={`Remove condition ${(index ?? 0) + 1}`}
          onClick={onRemove}
        >
          <X className="h-4 w-4" aria-hidden />
        </Button>
      ) : (
        <span aria-hidden />
      )}
    </div>
  );
}

/** Editable list of trigger conditions; starts with one empty row when none exist. */
export function TriggerConditionRows({
  conditions,
}: {
  conditions: Array<{ id: string; field: string; operator: string; value: unknown }>;
}) {
  const [rows, setRows] = useState(() =>
    conditions.length > 0
      ? conditions
      : [{ id: 'new-0', field: '', operator: 'EQUALS', value: '' as unknown }]
  );
  return (
    <div role="group" aria-label="Trigger conditions" className="space-y-2">
      {rows.length > 0 && (
        <div
          aria-hidden
          className="hidden gap-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:grid sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_2.25rem]"
        >
          <span>Field</span>
          <span>Operator</span>
          <span>Value</span>
        </div>
      )}
      {rows.map((row, index) => (
        <TriggerConditionRow
          key={row.id}
          index={index}
          field={row.field}
          operator={row.operator}
          value={row.value}
          onRemove={() => setRows(current => current.filter(item => item.id !== row.id))}
        />
      ))}
      {rows.length === 0 && (
        <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
          No conditions · Matches every new incident.
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        disabled={rows.length >= 20}
        onClick={() =>
          setRows(current => [
            ...current,
            { id: `new-${crypto.randomUUID()}`, field: '', operator: 'EQUALS', value: '' },
          ])
        }
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
        Add condition
      </Button>
    </div>
  );
}

/** Fails closed: corrupt or uninterpretable definitions count as writing. */
export function hasAgentWrites(definition: unknown): boolean {
  if (!definition || typeof definition !== 'object') return true;
  try {
    const rawSteps = (definition as { steps?: unknown[] }).steps;
    if (!Array.isArray(rawSteps) || rawSteps.length === 0) return true;

    const checkStep = (stepObj: unknown): boolean => {
      if (!stepObj || typeof stepObj !== 'object') return true;
      const step = stepObj as {
        type?: string;
        riskClass?: string;
        config?: Record<string, unknown>;
        precheck?: { steps?: unknown[] };
        verification?: { steps?: unknown[] };
      };

      if (typeof step.type === 'string' && requiresAgent(step.type as RunbookStepType)) {
        const derivedRisk = minimumRiskForStep({
          key: 'check',
          name: 'check',
          type: step.type as RunbookStepType,
          riskClass: (step.riskClass as RunbookRiskClass) ?? 'READ_ONLY',
          config: step.config ?? {},
        });
        const declaredRisk = step.riskClass;
        if (derivedRisk !== 'READ_ONLY' || (declaredRisk && declaredRisk !== 'READ_ONLY')) {
          return true;
        }
      }
      if (step.precheck && Array.isArray(step.precheck.steps)) {
        if (step.precheck.steps.some(checkStep)) return true;
      }
      if (step.verification && Array.isArray(step.verification.steps)) {
        if (step.verification.steps.some(checkStep)) return true;
      }
      return false;
    };

    return rawSteps.some(checkStep);
  } catch {
    return true;
  }
}
