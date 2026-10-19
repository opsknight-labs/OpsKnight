import type { Action, Condition, Field, Scalar } from '@/lib/automation/contract';

export function conditionOperators(
  type?: Field['type']
): Partial<Record<Condition['operator'], string>> {
  const common = {
    EQ: 'equals',
    NE: 'does not equal',
    IS_SET: 'is set',
    IS_MISSING: 'is missing',
  };
  if (type === 'BOOLEAN') return common;
  const lists = { ...common, IN: 'is one of', NOT_IN: 'is not one of' };
  if (type === 'NUMBER')
    return {
      ...lists,
      LT: 'is less than',
      LTE: 'is at most',
      GT: 'is greater than',
      GTE: 'is at least',
    };
  return type === 'ENUM' ? { ...lists, IS_UNMAPPED: 'is unmapped' } : lists;
}

const allOperatorLabels = new Map(
  Object.entries({ ...conditionOperators('NUMBER'), ...conditionOperators('ENUM') })
);

export function operatorLabel(operator: Condition['operator'], type?: Field['type']) {
  return (
    new Map(Object.entries(conditionOperators(type))).get(operator) ??
    allOperatorLabels.get(operator) ??
    operator.replaceAll('_', ' ').toLowerCase()
  );
}

export const isValuelessOperator = (operator: Condition['operator']) => operator.startsWith('IS_');
export const isListOperator = (operator: Condition['operator']) =>
  operator === 'IN' || operator === 'NOT_IN';

export function formatValue(value: Scalar | Scalar[] | undefined): string {
  if (Array.isArray(value)) return value.length ? value.map(String).join(', ') : '…';
  if (value === undefined || value === '') return '…';
  return String(value);
}

export function describeCondition(condition: Condition, fieldsByKey: Map<string, Field>): string {
  const field = fieldsByKey.get(condition.fieldKey);
  const label = field?.label ?? condition.fieldKey;
  const operator = operatorLabel(condition.operator, field?.type);
  return isValuelessOperator(condition.operator)
    ? `${label} ${operator}`
    : `${label} ${operator} ${formatValue(condition.value)}`;
}

export const ROUTE_ACTIONS = ['USE_SERVICE_DEFAULT', 'USE_ESCALATION_POLICY', 'NO_ESCALATION'];

export function describeAction(
  action: Action,
  lookups: {
    policies: Array<{ id: string; name: string }>;
    fieldsByKey: Map<string, Field>;
    destinations?: Array<{ id: string; provider: string; channelName: string | null }>;
  }
): string {
  switch (action.type) {
    case 'USE_SERVICE_DEFAULT':
      return 'Service default escalation';
    case 'USE_ESCALATION_POLICY':
      return (
        lookups.policies.find(policy => policy.id === action.policyId)?.name ?? 'Selected policy'
      );
    case 'NO_ESCALATION':
      return 'No escalation (no personal paging)';
    case 'NOTIFY_CHANNEL': {
      const destination = lookups.destinations?.find(d => d.id === action.destinationId);
      return `Notify ${action.provider === 'TEAMS' ? 'Teams' : 'Slack'}${destination?.channelName ? ` #${destination.channelName}` : ''}`;
    }
    case 'SET_PRIORITY':
      return `Set priority ${action.value}`;
    case 'SET_CONTEXT':
      return `Set ${lookups.fieldsByKey.get(action.fieldKey)?.label ?? (action.fieldKey || 'context')} to ${formatValue(action.value)}`;
    case 'ADD_TAG':
      return `Add tag ${action.value || '…'}`;
  }
}

export const FIELD_TYPE_LABELS: Record<Field['type'], string> = {
  STRING: 'Text',
  ENUM: 'Choice',
  NUMBER: 'Number',
  BOOLEAN: 'True / False',
};
