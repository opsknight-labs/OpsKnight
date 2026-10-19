'use client';

import { useId, useMemo, useState } from 'react';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Badge } from '@/components/ui/shadcn/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/shadcn/alert';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import {
  CONTEXT_CONDITION_WARNING,
  contextFieldKey,
  isValuelessOperator,
  operatorLabel,
  operatorsForContextField,
  type AutomationContextSummary,
  type ContextFieldOption,
} from './context-helpers';

export const INCIDENT_TRIGGER_FIELDS = [
  ['incident.urgency', 'Incident urgency', 'STRING'],
  ['incident.priority', 'Incident priority', 'STRING'],
  ['incident.status', 'Incident status', 'STRING'],
  ['incident.title', 'Incident title', 'STRING'],
  ['incident.description', 'Incident description', 'STRING'],
  ['incident.tags', 'Incident tags', 'TAGS'],
] as const;

export const SERVICE_TRIGGER_FIELDS = [
  ['service.name', 'Service name', 'STRING'],
  ['service.teamId', 'Service team', 'STRING'],
] as const;

export const MAX_TRIGGER_CONDITIONS = 20;
const NO_FIELD = 'none';

export type TriggerConditionInput = { field: string; operator: string; value: unknown };

type Row = { id: number; field: string; operator: string; value: string };

function displayValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(', ');
  if (value === null || value === undefined) return '';
  return String(value);
}

function modeLabel(mode: AutomationContextSummary['mode']) {
  return mode === 'SHADOW' ? 'Shadow' : mode === 'LIVE' ? 'Live' : 'Disabled';
}

export default function TriggerConditionEditor({
  conditions,
  automationContext,
}: {
  conditions: TriggerConditionInput[];
  automationContext: AutomationContextSummary | null;
}) {
  const baseId = useId();
  const contextFields = useMemo(() => automationContext?.fields ?? [], [automationContext]);
  const [rows, setRows] = useState<Row[]>(() =>
    (conditions.length > 0 ? conditions : [{ field: NO_FIELD, operator: 'EQUALS', value: '' }]).map(
      (condition, index) => ({
        id: index,
        field: condition.field || NO_FIELD,
        operator: condition.operator || 'EQUALS',
        value: displayValue(condition.value),
      })
    )
  );
  const [nextId, setNextId] = useState(rows.length);

  const findContextField = (field: string): ContextFieldOption | undefined => {
    const key = contextFieldKey(field);
    return key ? contextFields.find(candidate => candidate.key === key) : undefined;
  };
  const usesContext = rows.some(row => contextFieldKey(row.field) !== null);
  const contextLive = automationContext?.mode === 'LIVE';

  const update = (id: number, patch: Partial<Row>) =>
    setRows(current =>
      current.map(row => {
        if (row.id !== id) return row;
        const next = { ...row, ...patch };
        if (patch.field !== undefined && patch.field !== row.field) {
          const allowed = operatorsForContextField(findContextField(next.field));
          if (!allowed.includes(next.operator)) next.operator = 'EQUALS';
          next.value = '';
        }
        return next;
      })
    );

  const addRow = () => {
    setRows(current => [
      ...current,
      { id: nextId, field: NO_FIELD, operator: 'EQUALS', value: '' },
    ]);
    setNextId(id => id + 1);
  };
  const removeRow = (id: number) =>
    setRows(current =>
      current.length === 1
        ? [{ id: nextId, field: NO_FIELD, operator: 'EQUALS', value: '' }]
        : current.filter(row => row.id !== id)
    );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Label id={`${baseId}-label`}>Conditions</Label>
        {automationContext && (
          <Badge variant="outline" className="text-[11px] font-medium">
            Automation {modeLabel(automationContext.mode)}
            {automationContext.versionNumber !== null
              ? ` · v${automationContext.versionNumber}`
              : ''}
          </Badge>
        )}
      </div>

      {usesContext && !contextLive && (
        <Alert className="border-amber-500/40 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4 !text-amber-600" aria-hidden="true" />
          <AlertTitle className="text-sm">
            Service automation is {modeLabel(automationContext?.mode ?? 'DISABLED').toLowerCase()}
          </AlertTitle>
          <AlertDescription className="text-xs">{CONTEXT_CONDITION_WARNING}</AlertDescription>
        </Alert>
      )}

      <ol className="space-y-2.5" aria-labelledby={`${baseId}-label`}>
        {rows.map((row, index) => {
          const contextField = findContextField(row.field);
          const contextKey = contextFieldKey(row.field);
          const operators = operatorsForContextField(contextField);
          const knownField =
            row.field === NO_FIELD ||
            [...INCIDENT_TRIGGER_FIELDS, ...SERVICE_TRIGGER_FIELDS].some(
              ([candidate]) => candidate === row.field
            ) ||
            Boolean(contextField);
          const position = index + 1;
          return (
            <li key={row.id} className="rounded-md border bg-background/60 p-2.5">
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto]">
                <input type="hidden" name="conditionField" value={row.field} />
                <input type="hidden" name="conditionOperator" value={row.operator} />
                <Select value={row.field} onValueChange={field => update(row.id, { field })}>
                  <SelectTrigger aria-label={`Condition ${position} field`}>
                    <SelectValue placeholder="Field" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_FIELD}>No additional condition</SelectItem>
                    {!knownField && (
                      <SelectItem value={row.field}>
                        {contextKey ? `${row.field} (not in active version)` : row.field}
                      </SelectItem>
                    )}
                    <SelectSeparator />
                    <SelectGroup>
                      <SelectLabel>Incident Fields</SelectLabel>
                      {INCIDENT_TRIGGER_FIELDS.map(([value, label, type]) => (
                        <SelectItem key={value} value={value}>
                          {label} ({type.toLowerCase()})
                        </SelectItem>
                      ))}
                    </SelectGroup>
                    <SelectSeparator />
                    <SelectGroup>
                      <SelectLabel>Service Fields</SelectLabel>
                      {SERVICE_TRIGGER_FIELDS.map(([value, label, type]) => (
                        <SelectItem key={value} value={value}>
                          {label} ({type.toLowerCase()})
                        </SelectItem>
                      ))}
                    </SelectGroup>
                    {contextFields.length > 0 && (
                      <>
                        <SelectSeparator />
                        <SelectGroup>
                          <SelectLabel>Automation Context</SelectLabel>
                          {contextFields.map(field => (
                            <SelectItem key={field.key} value={`automation.${field.key}`}>
                              {field.label} · automation.{field.key} ({field.type.toLowerCase()})
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </>
                    )}
                  </SelectContent>
                </Select>

                <Select
                  value={row.operator}
                  onValueChange={operator => update(row.id, { operator })}
                >
                  <SelectTrigger aria-label={`Condition ${position} operator`}>
                    <SelectValue placeholder="Operator" />
                  </SelectTrigger>
                  <SelectContent>
                    {operators.map(operator => (
                      <SelectItem key={operator} value={operator}>
                        {operatorLabel(operator, contextField)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <ConditionValueInput
                  row={row}
                  position={position}
                  field={contextField}
                  onChange={value => update(row.id, { value })}
                />

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 text-muted-foreground hover:text-destructive"
                  aria-label={`Remove condition ${position}`}
                  onClick={() => removeRow(row.id)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
              {contextField && (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {contextField.type === 'ENUM'
                    ? 'Choose from the field’s canonical values.'
                    : contextField.type === 'STRING' && !contextField.caseSensitive
                      ? 'Compared case-insensitively against the normalized automation value.'
                      : `Compared as a ${contextField.type.toLowerCase()}.`}{' '}
                  Missing and unmapped values never satisfy value or negative comparisons; use “Is
                  missing” / “Is unmapped” to match them explicitly.
                </p>
              )}
              {contextKey && !contextField && (
                <p role="alert" className="mt-1.5 text-[11px] text-destructive">
                  automation.{contextKey} is not declared by the active automation version. This
                  rule is configuration-invalid and will not fire. Remove the condition or declare
                  the field in Service Automation.
                </p>
              )}
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5"
          onClick={addRow}
          disabled={rows.length >= MAX_TRIGGER_CONDITIONS}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add condition
        </Button>
        <p className="text-xs text-muted-foreground">
          Comma-separate values for “is one of”. Automatic mode still stops at approval gates.
        </p>
      </div>
    </div>
  );
}

function ConditionValueInput({
  row,
  position,
  field,
  onChange,
}: {
  row: Row;
  position: number;
  field: ContextFieldOption | undefined;
  onChange: (value: string) => void;
}) {
  const label = `Condition ${position} value`;
  if (isValuelessOperator(row.operator)) {
    return (
      <>
        <input type="hidden" name="conditionValue" value="" />
        <p className="flex h-9 items-center text-xs text-muted-foreground">No value needed</p>
      </>
    );
  }
  const list = row.operator === 'IN' || row.operator === 'NOT_IN';
  const choices =
    field?.type === 'ENUM' && field.allowedValues?.length
      ? field.allowedValues
      : field?.type === 'BOOLEAN'
        ? ['true', 'false']
        : null;

  if (choices && !list) {
    return (
      <>
        <input type="hidden" name="conditionValue" value={row.value} />
        <Select value={row.value || undefined} onValueChange={onChange}>
          <SelectTrigger aria-label={label}>
            <SelectValue placeholder="Select value" />
          </SelectTrigger>
          <SelectContent>
            {choices.map(choice => (
              <SelectItem key={choice} value={choice}>
                {choice}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </>
    );
  }

  if (choices && list) {
    const selected = new Set(
      row.value
        .split(',')
        .map(item => item.trim())
        .filter(Boolean)
    );
    const toggle = (choice: string, checked: boolean) => {
      const next = choices.filter(candidate =>
        candidate === choice ? checked : selected.has(candidate)
      );
      onChange(next.join(', '));
    };
    return (
      <fieldset className="min-w-0 rounded-md border px-2.5 py-1.5">
        <legend className="sr-only">{label}</legend>
        <input type="hidden" name="conditionValue" value={row.value} />
        <div className="flex max-h-28 flex-wrap gap-x-3 gap-y-1 overflow-y-auto">
          {choices.map(choice => (
            <label key={choice} className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                className="h-3.5 w-3.5"
                checked={selected.has(choice)}
                onChange={event => toggle(choice, event.target.checked)}
              />
              {choice}
            </label>
          ))}
        </div>
      </fieldset>
    );
  }

  return (
    <Input
      name="conditionValue"
      aria-label={label}
      value={row.value}
      onChange={event => onChange(event.target.value)}
      inputMode={field?.type === 'NUMBER' ? 'decimal' : undefined}
      placeholder={list ? 'value-a, value-b' : 'Match value'}
    />
  );
}
