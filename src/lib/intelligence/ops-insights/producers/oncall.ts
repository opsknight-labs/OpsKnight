import 'server-only';
import {
  derivePersonInsights,
  deriveScheduleInsights,
  type PersonInsightInput,
  type ScheduleInsightInput,
} from '@/lib/oncall-load/insights';
import { loadPersonInsightInput, loadScheduleInsightInput } from '@/lib/oncall-load/store';
import type { OpsInsightProducer } from '../producer';

/**
 * On-call schedules (plan J3). Schedule insights: coverage gap in the next 14 days, one person as both
 * primary and backup, uneven load across the rotation. They hold counts only, never who: the Load & fairness
 * tab shows names to the people allowed to see them.
 */
export const onCallScheduleProducer: OpsInsightProducer<ScheduleInsightInput> = {
  kind: 'oncall.schedule',
  version: 1,
  area: 'onCall',
  scopeType: 'SCHEDULE',
  loadInput: (scope, { tx, now }) => loadScheduleInsightInput(scope.id, now, tx),
  derive: deriveScheduleInsights,
};

/**
 * Person insights, visible to that person, their team lead and administrators: load above the rotation's
 * mean, sustained night pages, and a heads-up when the next shift's services carry a known risk.
 */
export const onCallPersonProducer: OpsInsightProducer<PersonInsightInput> = {
  kind: 'oncall.person',
  version: 1,
  area: 'onCall',
  scopeType: 'USER',
  loadInput: (scope, { tx, now }) => loadPersonInsightInput(scope.id, now, tx),
  derive: derivePersonInsights,
};
