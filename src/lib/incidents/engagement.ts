import type { IncidentUrgency } from '@prisma/client';
import type { SupportHoursDecision } from './support-hours';
import { addOperationalMetric } from '@/lib/metrics/operational/registry';

export type IncidentEngagementDecision = {
  urgency: IncidentUrgency;
  trafficClass: 'CRITICAL' | 'STANDARD' | 'DEFERABLE';
  supportHoursState: SupportHoursDecision['state'];
  earliestDeliveryAt: Date;
  deferred: boolean;
  reason: string;
};

/** Policy decision only. Provider/channel selection remains in escalation and notification config. */
export function resolveIncidentEngagement(input: {
  urgency: IncidentUrgency;
  supportHours: SupportHoursDecision;
  now: Date;
}): IncidentEngagementDecision {
  const trafficClass =
    input.urgency === 'HIGH' ? 'CRITICAL' : input.urgency === 'LOW' ? 'DEFERABLE' : 'STANDARD';
  const deferred =
    input.urgency === 'LOW' &&
    input.supportHours.state === 'OUTSIDE' &&
    input.supportHours.nextSupportAt !== null;
  if (deferred)
    addOperationalMetric('opsknight_engagement_deferred_total', 1, { urgency: input.urgency });
  return {
    urgency: input.urgency,
    trafficClass,
    supportHoursState: input.supportHours.state,
    earliestDeliveryAt: deferred ? input.supportHours.nextSupportAt! : input.now,
    deferred,
    reason: deferred
      ? 'LOW urgency deferred until support hours'
      : input.urgency === 'HIGH'
        ? 'HIGH urgency bypasses interruption deferral'
        : 'Standard engagement path',
  };
}
