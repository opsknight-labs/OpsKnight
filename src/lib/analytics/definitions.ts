/**
 * The metric registry. Labels, formulas, units and "which direction is good"
 * live here once; the page tooltips and the CSV export headers are generated
 * from it, so a definition cannot drift between surfaces.
 *
 * Every metric is attributed to the window by incident `createdAt`, and a
 * metric with no qualifying incidents is `null` (shown as "No data"), never 0.
 */

export type MetricUnit = 'count' | 'duration' | 'percent' | 'ratio' | 'hours';

export type MetricDefinition = {
  label: string;
  unit: MetricUnit;
  /** Which direction counts as an improvement; drives delta colouring. */
  better: 'up' | 'down' | 'neutral';
  description: string;
};

export const METRICS = {
  incidents: {
    label: 'Incidents',
    unit: 'count',
    better: 'down',
    description: 'Incidents created in the selected period that match the filters.',
  },
  openNow: {
    label: 'Open now',
    unit: 'count',
    better: 'down',
    description:
      'Incidents matching the filters that are open, acknowledged or snoozed right now, whenever they were created.',
  },
  mttaP50: {
    label: 'MTTA (median)',
    unit: 'duration',
    better: 'down',
    description:
      'Median time from creation to first acknowledgement, excluding SLA pauses. Unacknowledged incidents are excluded.',
  },
  mttaP90: {
    label: 'MTTA (p90)',
    unit: 'duration',
    better: 'down',
    description:
      '90th percentile time to acknowledge: nine in ten incidents were acknowledged faster.',
  },
  mttrP50: {
    label: 'MTTR (median)',
    unit: 'duration',
    better: 'down',
    description:
      'Median time from creation to resolution, excluding SLA pauses. Only resolved incidents count.',
  },
  mttrP90: {
    label: 'MTTR (p90)',
    unit: 'duration',
    better: 'down',
    description: '90th percentile time to resolve: nine in ten resolved incidents closed faster.',
  },
  ackSla: {
    label: 'Ack SLA met',
    unit: 'percent',
    better: 'up',
    description:
      'Share of incidents acknowledged within the SLA target frozen on the incident at creation. Incidents still inside their target are not counted yet.',
  },
  resolveSla: {
    label: 'Resolve SLA met',
    unit: 'percent',
    better: 'up',
    description:
      'Share of incidents resolved within the SLA target frozen on the incident at creation. Open incidents count once they pass their target.',
  },
  escalationRate: {
    label: 'Escalated',
    unit: 'percent',
    better: 'down',
    description: 'Share of incidents with at least one escalation to a further responder or level.',
  },
  afterHoursRate: {
    label: 'After hours',
    unit: 'percent',
    better: 'down',
    description:
      'Share of incidents created outside business hours (Mon–Fri 08:00–18:00 in the workspace business-hours timezone).',
  },
  alertsPerIncident: {
    label: 'Alerts per incident',
    unit: 'ratio',
    better: 'down',
    description:
      'Alerts grouped into each incident on average. High values point at noisy, duplicated signals.',
  },
  autoResolvedRate: {
    label: 'Auto-resolved',
    unit: 'percent',
    better: 'neutral',
    description:
      'Share of resolved incidents closed by the source recovering, an automation or a timeout rather than a person.',
  },
  postmortemRate: {
    label: 'Postmortems published',
    unit: 'percent',
    better: 'up',
    description: 'Share of resolved high-urgency incidents that have a published postmortem.',
  },
  actionItemsOpen: {
    label: 'Open action items',
    unit: 'count',
    better: 'down',
    description: 'Postmortem action items not yet completed for incidents in the period.',
  },
  actionItemsOverdue: {
    label: 'Overdue action items',
    unit: 'count',
    better: 'down',
    description: 'Open action items whose due date has passed.',
  },
  onCallHours: {
    label: 'On-call hours',
    unit: 'hours',
    better: 'neutral',
    description: 'Scheduled on-call time in the period, from schedule layers and overrides.',
  },
  handlingHours: {
    label: 'Hours handling',
    unit: 'hours',
    better: 'neutral',
    description:
      'An estimate of time spent on incidents: for each incident assigned to the responder, the time from acknowledgement to resolution (or to the end of the period if still open), counted only inside the period and excluding SLA pauses. Off-hours is the part in their evenings, weekends and nights, in their own timezone. Overlapping incidents each count.',
  },
  offHoursInterruptions: {
    label: 'Off-hours interruptions',
    unit: 'count',
    better: 'down',
    description:
      "Assigned incidents created in the responder's evening, weekend or overnight hours, in their own timezone. Totals match the evening and overnight counts in Responder load.",
  },
  uptime: {
    label: 'Uptime',
    unit: 'percent',
    better: 'up',
    description:
      'Share of the period with no open incident on the service. Suppressed and snoozed incidents do not count as downtime.',
  },
  errorBudgetRemaining: {
    label: 'Error budget left',
    unit: 'percent',
    better: 'up',
    description:
      "Share of the downtime the service's uptime objective allows in this period that is still unused. Allowed downtime is (100% − target) of the selected period, not the objective's own window.",
  },
} as const satisfies Record<string, MetricDefinition>;

export type MetricId = keyof typeof METRICS;

/** Percent change; null when either side is missing or the base is zero. */
export function percentChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

/** Safe ratio: null when there is nothing to divide by. */
export function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}
