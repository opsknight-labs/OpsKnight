/* eslint-disable security/detect-object-injection -- Condition indices come from local map callbacks. */
'use client';
import { Button } from '@/components/ui/shadcn/button';
import { TypedValueInput } from './TypedValueInput';
import type { Rule, Field, Condition } from '@/lib/automation/contract';
export function conditionOperators(type?: Field['type']) {
  const common = { EQ: 'is', NE: 'is not', IS_SET: 'is set', IS_MISSING: 'is missing' };
  if (type === 'BOOLEAN') return common;
  const lists = { ...common, IN: 'is one of', NOT_IN: 'is not one of' };
  if (type === 'NUMBER')
    return { ...lists, LT: 'less than', LTE: 'at most', GT: 'greater than', GTE: 'at least' };
  return type === 'ENUM' ? { ...lists, IS_UNMAPPED: 'is unmapped' } : lists;
}
const controlClass = 'rounded-md border border-input bg-background px-3 py-2 text-sm max-w-full';
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
  return (
    <>
      <p className="text-sm font-medium">
        IF {rule.conditions.length === 0 ? 'any alert arrives' : 'all conditions match'}
      </p>
      {rule.conditions.map((condition, n) => (
        <div
          key={n}
          role="group"
          aria-label={`Condition ${n + 1}`}
          className="flex flex-wrap gap-2"
        >
          <select
            aria-label="Condition field"
            className={controlClass}
            disabled={!canEdit}
            value={condition.fieldKey}
            onChange={e => {
              const conditions = [...rule.conditions];
              conditions[n] = {
                fieldKey: e.target.value,
                operator: 'IS_SET',
              };
              onChange({ conditions });
            }}
          >
            {fields.map(f => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Condition operator"
            className={controlClass}
            disabled={!canEdit}
            value={condition.operator}
            onChange={e => {
              const conditions = [...rule.conditions];
              const operator = e.target.value as Condition['operator'];
              conditions[n] = {
                ...condition,
                operator,
                value: operator.startsWith('IS_')
                  ? undefined
                  : ['IN', 'NOT_IN'].includes(operator)
                    ? []
                    : '',
              };
              onChange({ conditions });
            }}
          >
            {Object.entries(
              conditionOperators(fields.find(f => f.key === condition.fieldKey)?.type)
            ).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          {!condition.operator.startsWith('IS_') && (
            <TypedValueInput
              label="Condition value"
              type={fields.find(f => f.key === condition.fieldKey)?.type}
              canonicalValues={fields.find(f => f.key === condition.fieldKey)?.allowedValues}
              disabled={!canEdit}
              value={condition.value}
              list={['IN', 'NOT_IN'].includes(condition.operator)}
              onChange={value => {
                const conditions = [...rule.conditions];
                conditions[n] = { ...condition, value };
                onChange({ conditions });
              }}
            />
          )}
          {canEdit && (
            <Button
              aria-label="Remove condition"
              variant="ghost"
              size="sm"
              onClick={() =>
                onChange({
                  conditions: rule.conditions.filter((_, i) => i !== n),
                })
              }
            >
              Remove
            </Button>
          )}
        </div>
      ))}
      {canEdit && (
        <Button
          size="sm"
          variant="outline"
          disabled={rule.conditions.length >= 20 || !fields.length}
          onClick={() =>
            onChange({
              conditions: [...rule.conditions, { fieldKey: fields[0].key, operator: 'IS_SET' }],
            })
          }
        >
          Add condition
        </Button>
      )}
    </>
  );
}
