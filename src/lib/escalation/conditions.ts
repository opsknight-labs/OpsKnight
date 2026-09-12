import type { IncidentUrgency } from '@prisma/client';
import type { IncidentPriority } from '@/lib/incidents/priority';
import type { SupportHoursState } from '@/lib/incidents/support-hours';

export type EscalationCondition = { field: string; operator: string; values: string[] };
export type EscalationConditionContext = {
  priority: IncidentPriority | null;
  urgency: IncidentUrgency;
  supportHoursState: SupportHoursState;
};

export function escalationConditionsMatch(
  conditions: readonly EscalationCondition[],
  context: EscalationConditionContext
): boolean {
  return conditions.every(condition => {
    const validField =
      condition.field === 'PRIORITY' ||
      condition.field === 'URGENCY' ||
      condition.field === 'SUPPORT_HOURS_STATE';
    const validOperator =
      condition.operator === 'IN' ||
      condition.operator === 'NOT_IN' ||
      condition.operator === 'EQUALS' ||
      condition.operator === 'NOT_EQUALS';
    if (!validField || !validOperator) return false;
    const actual =
      condition.field === 'PRIORITY'
        ? context.priority
        : condition.field === 'URGENCY'
          ? context.urgency
          : condition.field === 'SUPPORT_HOURS_STATE'
            ? context.supportHoursState
            : null;
    if (actual === null) return false;
    const included = condition.values.includes(actual);
    if (condition.operator === 'IN' || condition.operator === 'EQUALS') return included;
    if (condition.operator === 'NOT_IN' || condition.operator === 'NOT_EQUALS') return !included;
    return false;
  });
}
