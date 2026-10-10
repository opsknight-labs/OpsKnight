'use client';

import { Label } from '@/components/ui/shadcn/label';
import { Input } from '@/components/ui/shadcn/input';
import { FormSelect } from '../../RunbookControls';
import { CONDITION_FIELDS, canonicalConditionField } from '@/lib/runbooks/builder';
import type { RunbookInputInput } from '@/lib/runbooks/schemas';

interface ConditionActionEditorProps {
  config: Record<string, unknown>;
  errors?: Record<string, string>;
  inputs: RunbookInputInput[];
  editorId?: string;
  readOnly?: boolean;
  onChange: (config: Record<string, unknown>) => void;
}

const CONDITION_OPERATORS = [
  { value: 'EQUALS', label: 'Equals (==)' },
  { value: 'NOT_EQUALS', label: 'Not Equals (!=)' },
  { value: 'CONTAINS', label: 'Contains (substring)' },
  { value: 'STARTS_WITH', label: 'Starts with' },
  { value: 'IN', label: 'In list (comma-separated)' },
  { value: 'NOT_IN', label: 'Not in list (comma-separated)' },
  { value: 'EXISTS', label: 'Exists (is defined)' },
  { value: 'NOT_EXISTS', label: 'Does not exist (is undefined or null)' },
];

export default function ConditionActionEditor({
  config,
  errors = {},
  inputs,
  editorId = 'cond',
  readOnly = false,
  onChange,
}: ConditionActionEditorProps) {
  const field = canonicalConditionField(String(config.field ?? 'incident.priority'));
  const operator = String(config.operator ?? 'EQUALS');
  const rawValue = config.value;
  const isUnary = ['EXISTS', 'NOT_EXISTS'].includes(operator);

  const targetInput = inputs.find(
    inp => field === `input.${inp.key}` || field === `inputs.${inp.key}`
  );

  const valueString =
    rawValue === undefined || rawValue === null
      ? ''
      : Array.isArray(rawValue)
        ? rawValue.join(', ')
        : String(rawValue);

  const coerceValue = (valStr: string, op: string) => {
    if (['IN', 'NOT_IN'].includes(op)) {
      const parts = valStr
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      if (targetInput?.type === 'NUMBER') {
        return parts.map(p => (!isNaN(Number(p)) && p !== '' ? Number(p) : p));
      }
      if (targetInput?.type === 'BOOLEAN') {
        return parts.map(p => {
          const lower = p.toLowerCase();
          if (lower === 'true') return true;
          if (lower === 'false') return false;
          return p;
        });
      }
      return parts;
    }

    if (targetInput?.type === 'NUMBER') {
      const trimmed = valStr.trim();
      if (trimmed !== '' && !isNaN(Number(trimmed))) {
        return Number(trimmed);
      }
      return valStr;
    }
    if (targetInput?.type === 'BOOLEAN') {
      const lower = valStr.trim().toLowerCase();
      if (lower === 'true') return true;
      if (lower === 'false') return false;
      return valStr;
    }
    return valStr;
  };

  const handleFieldChange = (nextField: string) => {
    const nextTargetInput = inputs.find(
      inp => nextField === `input.${inp.key}` || nextField === `inputs.${inp.key}`
    );
    let nextValue = config.value;
    if (valueString !== '' && !['EXISTS', 'NOT_EXISTS'].includes(operator)) {
      if (nextTargetInput?.type === 'NUMBER') {
        if (!isNaN(Number(valueString))) {
          nextValue = Number(valueString);
        }
      } else if (nextTargetInput?.type === 'BOOLEAN') {
        if (valueString.toLowerCase() === 'true') nextValue = true;
        else if (valueString.toLowerCase() === 'false') nextValue = false;
      }
    }
    onChange({ ...config, field: nextField, value: nextValue });
  };

  const handleOperatorChange = (nextOp: string) => {
    const nextConfig: Record<string, unknown> = { ...config, operator: nextOp };
    if (['EXISTS', 'NOT_EXISTS'].includes(nextOp)) {
      nextConfig.value = null;
    } else if (['IN', 'NOT_IN'].includes(nextOp)) {
      nextConfig.value = coerceValue(valueString, nextOp);
    } else {
      let scalarStr = '';
      if (Array.isArray(rawValue)) {
        scalarStr = rawValue.length > 0 ? String(rawValue[0]) : '';
      } else if (rawValue === null || rawValue === undefined) {
        scalarStr = '';
      } else {
        scalarStr = String(rawValue);
      }
      nextConfig.value = coerceValue(scalarStr, nextOp);
    }
    onChange(nextConfig);
  };

  const handleValueChange = (nextValStr: string) => {
    const finalVal = coerceValue(nextValStr, operator);
    onChange({ ...config, value: finalVal });
  };

  const placeholderText = ['IN', 'NOT_IN'].includes(operator)
    ? targetInput?.type === 'NUMBER'
      ? 'e.g. 1, 2, 3'
      : 'e.g. P1, P2, CRITICAL'
    : targetInput?.type === 'NUMBER'
      ? 'e.g. 3'
      : targetInput?.type === 'BOOLEAN'
        ? 'true or false'
        : 'e.g. P1';

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor={`condition-field-${editorId}`}>Incident / Context Field</Label>
          <div className="mt-1.5">
            <FormSelect
              name={`condition-field-${editorId}`}
              label="Condition field"
              value={field}
              disabled={readOnly}
              onValueChange={handleFieldChange}
              options={[
                ...CONDITION_FIELDS,
                ...inputs.map(input => ({
                  value: `input.${input.key}`,
                  label: `Input → ${input.label} (${input.key})`,
                })),
              ]}
            />
          </div>
          {errors.field && <p className="mt-1 text-xs text-destructive">{errors.field}</p>}
        </div>

        <div>
          <Label htmlFor={`condition-operator-${editorId}`}>Comparison Operator</Label>
          <div className="mt-1.5">
            <FormSelect
              name={`condition-operator-${editorId}`}
              label="Operator"
              value={operator}
              disabled={readOnly}
              onValueChange={handleOperatorChange}
              options={CONDITION_OPERATORS}
            />
          </div>
          {errors.operator && <p className="mt-1 text-xs text-destructive">{errors.operator}</p>}
        </div>
      </div>

      {!isUnary && (
        <div>
          <Label htmlFor={`condition-value-${editorId}`}>Match Value</Label>
          <div className="mt-1.5">
            <Input
              id={`condition-value-${editorId}`}
              aria-label="Match value (comma-separated for IN / NOT_IN)"
              placeholder={placeholderText}
              value={valueString}
              disabled={readOnly}
              onChange={e => handleValueChange(e.target.value)}
              className={errors.value ? 'border-destructive' : ''}
            />
          </div>
          {errors.value ? (
            <p className="mt-1 text-xs text-destructive">{errors.value}</p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              A false condition aborts evaluation and skips subsequent steps.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
