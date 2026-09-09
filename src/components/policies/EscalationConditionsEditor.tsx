'use client';

import { Button } from '@/components/ui/shadcn/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';

export type EditableEscalationCondition = {
  field: 'PRIORITY' | 'URGENCY' | 'SUPPORT_HOURS_STATE';
  operator: 'IN' | 'NOT_IN' | 'EQUALS' | 'NOT_EQUALS';
  values: string[];
};
const valuesByField = {
  PRIORITY: ['P1', 'P2', 'P3', 'P4', 'P5'],
  URGENCY: ['HIGH', 'MEDIUM', 'LOW'],
  SUPPORT_HOURS_STATE: ['INSIDE', 'OUTSIDE', 'UNCONFIGURED'],
} as const;

export default function EscalationConditionsEditor({
  value,
  onChange,
  disabled,
}: {
  value: EditableEscalationCondition[];
  onChange: (value: EditableEscalationCondition[]) => void;
  disabled?: boolean;
}) {
  const update = (index: number, patch: Partial<EditableEscalationCondition>) =>
    onChange(
      value.map((condition, candidate) =>
        candidate === index ? { ...condition, ...patch } : condition
      )
    );
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold">Conditions (all must match)</span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || value.length >= 10}
          onClick={() =>
            onChange([...value, { field: 'PRIORITY', operator: 'IN', values: ['P1'] }])
          }
        >
          Add condition
        </Button>
      </div>
      {value.length === 0 && (
        <p className="text-[11px] text-muted-foreground">
          No conditions: this legacy-compatible step always applies.
        </p>
      )}
      {value.map((condition, index) => (
        <div
          key={`${index}-${condition.field}`}
          className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2"
        >
          <Select
            value={condition.field}
            disabled={disabled}
            onValueChange={field =>
              update(index, {
                field: field as EditableEscalationCondition['field'],
                values: [valuesByField[field as keyof typeof valuesByField][0]],
              })
            }
          >
            <SelectTrigger aria-label={`Condition ${index + 1} field`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.keys(valuesByField).map(field => (
                <SelectItem key={field} value={field}>
                  {field.replaceAll('_', ' ')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={condition.operator}
            disabled={disabled}
            onValueChange={operator =>
              update(index, { operator: operator as EditableEscalationCondition['operator'] })
            }
          >
            <SelectTrigger aria-label={`Condition ${index + 1} operator`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {['IN', 'NOT_IN', 'EQUALS', 'NOT_EQUALS'].map(operator => (
                <SelectItem key={operator} value={operator}>
                  {operator.replaceAll('_', ' ')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={condition.values[0]}
            disabled={disabled}
            onValueChange={selected => update(index, { values: [selected] })}
          >
            <SelectTrigger aria-label={`Condition ${index + 1} value`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {valuesByField[condition.field].map(option => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="ghost"
            disabled={disabled}
            onClick={() => onChange(value.filter((_, candidate) => candidate !== index))}
          >
            Remove
          </Button>
        </div>
      ))}
    </div>
  );
}
