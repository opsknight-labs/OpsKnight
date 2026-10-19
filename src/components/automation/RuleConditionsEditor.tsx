/* eslint-disable security/detect-object-injection -- Condition indices come from local map callbacks. */
'use client';
import { memo, useMemo } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import {
  builtinFields,
  LIMITS,
  type Rule,
  type Field,
  type Condition,
} from '@/lib/automation/contract';
import { TypedValueInput } from './TypedValueInput';
import { AuthoringFieldset, Hint, LimitCounter, NativeSelect } from './authoring/primitives';
import { useStableCallback } from './authoring/hooks';
import {
  conditionOperators,
  isListOperator,
  isValuelessOperator,
  operatorLabel,
} from './authoring/rule-language';

export { conditionOperators };

const builtinKeys = new Set(builtinFields.map(field => field.key));

// Keeps the authored value when switching between compatible operators (e.g. equals -> does not equal).
function nextConditionValue(
  previous: Condition['value'],
  operator: Condition['operator']
): Condition['value'] {
  if (isValuelessOperator(operator)) return undefined;
  if (isListOperator(operator)) {
    if (Array.isArray(previous)) return previous;
    return previous === undefined || previous === '' ? [] : [previous];
  }
  if (Array.isArray(previous)) return previous[0] ?? '';
  return previous ?? '';
}

const ConditionRow = memo(function ConditionRow({
  condition,
  index,
  field,
  fieldOptions,
  canEdit,
  onFieldChange,
  onOperatorChange,
  onValueChange,
  onRemove,
}: {
  condition: Condition;
  index: number;
  field: Field | undefined;
  fieldOptions: { builtin: Field[]; context: Field[] };
  canEdit: boolean;
  onFieldChange: (index: number, fieldKey: string) => void;
  onOperatorChange: (index: number, operator: Condition['operator']) => void;
  onValueChange: (index: number, value: Condition['value']) => void;
  onRemove: (index: number) => void;
}) {
  const operators = conditionOperators(field?.type);
  const operatorKnown = condition.operator in operators;
  return (
    <div
      role="group"
      aria-label={`Condition ${index + 1}`}
      className="grid items-start gap-2 rounded-md border border-border/70 bg-background/60 p-2 sm:grid-cols-[2.75rem_minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,1.2fr)_2.5rem]"
    >
      <span
        aria-hidden="true"
        className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:pt-3"
      >
        {index === 0 ? 'When' : 'and'}
      </span>
      <NativeSelect
        aria-label="Condition field"
        disabled={!canEdit}
        value={condition.fieldKey}
        onChange={event => onFieldChange(index, event.target.value)}
      >
        {!field && <option value={condition.fieldKey}>{condition.fieldKey} (missing field)</option>}
        <optgroup label="Built-in">
          {fieldOptions.builtin.map(option => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </optgroup>
        {fieldOptions.context.length > 0 && (
          <optgroup label="Context fields">
            {fieldOptions.context.map(option => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </optgroup>
        )}
      </NativeSelect>
      <NativeSelect
        aria-label="Condition operator"
        disabled={!canEdit}
        value={condition.operator}
        onChange={event => onOperatorChange(index, event.target.value as Condition['operator'])}
      >
        {!operatorKnown && (
          <option value={condition.operator}>
            {operatorLabel(condition.operator)} (not valid for this field)
          </option>
        )}
        {Object.entries(operators).map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </NativeSelect>
      {isValuelessOperator(condition.operator) ? (
        <span className="hidden sm:block" aria-hidden="true" />
      ) : (
        <TypedValueInput
          label="Condition value"
          type={field?.type}
          canonicalValues={field?.allowedValues}
          disabled={!canEdit}
          value={condition.value}
          list={isListOperator(condition.operator)}
          onChange={value => onValueChange(index, value)}
        />
      )}
      {canEdit && (
        <Button
          aria-label={`Remove condition ${index + 1}`}
          variant="ghost"
          size="icon"
          className="justify-self-end text-muted-foreground hover:text-destructive"
          onClick={() => onRemove(index)}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      )}
    </div>
  );
});

export function RuleConditionsEditor({
  rule,
  fields,
  canEdit,
  onChange,
}: {
  rule: Rule;
  fields: Field[];
  canEdit: boolean;
  onChange: (update: Partial<Rule>) => void;
}) {
  const fieldsByKey = useMemo(() => new Map(fields.map(field => [field.key, field])), [fields]);
  const fieldOptions = useMemo(
    () => ({
      builtin: fields.filter(field => builtinKeys.has(field.key)),
      context: fields.filter(field => !builtinKeys.has(field.key)),
    }),
    [fields]
  );
  const replace = useStableCallback((index: number, next: Condition) => {
    const conditions = [...rule.conditions];
    conditions[index] = next;
    onChange({ conditions });
  });
  const onFieldChange = useStableCallback((index: number, fieldKey: string) =>
    replace(index, { fieldKey, operator: 'IS_SET' })
  );
  const onOperatorChange = useStableCallback((index: number, operator: Condition['operator']) => {
    const condition = rule.conditions[index];
    replace(index, {
      ...condition,
      operator,
      value: nextConditionValue(condition.value, operator),
    });
  });
  const onValueChange = useStableCallback((index: number, value: Condition['value']) =>
    replace(index, { ...rule.conditions[index], value })
  );
  const onRemove = useStableCallback((index: number) =>
    onChange({ conditions: rule.conditions.filter((_, i) => i !== index) })
  );
  const atLimit = rule.conditions.length >= LIMITS.conditions;
  return (
    <AuthoringFieldset
      legend="Conditions"
      aside={
        <LimitCounter count={rule.conditions.length} limit={LIMITS.conditions} noun="conditions" />
      }
      description={
        rule.conditions.length === 0
          ? 'No conditions — this rule applies to every alert.'
          : 'All conditions must match. Missing or unmapped values never satisfy value or negative comparisons; use “is missing” or “is unmapped” to match them.'
      }
    >
      {rule.conditions.map((condition, n) => (
        <ConditionRow
          key={n}
          condition={condition}
          index={n}
          field={fieldsByKey.get(condition.fieldKey)}
          fieldOptions={fieldOptions}
          canEdit={canEdit}
          onFieldChange={onFieldChange}
          onOperatorChange={onOperatorChange}
          onValueChange={onValueChange}
          onRemove={onRemove}
        />
      ))}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-10 sm:h-9"
            disabled={atLimit || !fields.length}
            onClick={() =>
              onChange({
                conditions: [...rule.conditions, { fieldKey: fields[0].key, operator: 'IS_SET' }],
              })
            }
          >
            <Plus aria-hidden="true" />
            Add condition
          </Button>
          {atLimit && <Hint>Condition limit reached. Remove one to add another.</Hint>}
        </div>
      )}
    </AuthoringFieldset>
  );
}
