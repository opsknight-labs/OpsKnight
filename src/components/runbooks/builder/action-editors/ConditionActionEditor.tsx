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

  const valueString =
    rawValue === undefined || rawValue === null
      ? ''
      : Array.isArray(rawValue)
        ? rawValue.join(', ')
        : String(rawValue);

  const handleOperatorChange = (nextOp: string) => {
    const nextConfig: Record<string, unknown> = { ...config, operator: nextOp };
    if (['EXISTS', 'NOT_EXISTS'].includes(nextOp)) {
      nextConfig.value = null;
    } else if (['IN', 'NOT_IN'].includes(nextOp)) {
      nextConfig.value = valueString.split(',').map(s => s.trim()).filter(Boolean);
    }
    onChange(nextConfig);
  };

  const handleValueChange = (nextValStr: string) => {
    let finalVal: unknown = nextValStr;
    if (['IN', 'NOT_IN'].includes(operator)) {
      finalVal = nextValStr.split(',').map(s => s.trim()).filter(Boolean);
    }
    onChange({ ...config, value: finalVal });
  };

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
              onValueChange={(nextField: string) => onChange({ ...config, field: nextField })}
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
          <Label htmlFor="condition-operator">Comparison Operator</Label>
          <div className="mt-1.5">
            <FormSelect
              name="condition-operator"
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
          <Label htmlFor="condition-value">Match Value</Label>
          <div className="mt-1.5">
            <Input
              id="condition-value"
              aria-label="Match value (comma-separated for IN / NOT_IN)"
              placeholder={['IN', 'NOT_IN'].includes(operator) ? 'e.g. P1, P2, CRITICAL' : 'e.g. P1'}
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
