import { OBJECTIVE_COMPARATORS, OBJECTIVE_WINDOWS } from './types';

/** Existing supported measurements only. Availability is deliberately identified as the
 * uptime alias implemented by the current metrics engine, never as request-success telemetry.
 */
export const SERVICE_OBJECTIVE_CONTRACT = {
  version: 1,
  metrics: [
    {
      id: 'UPTIME',
      unit: 'percent',
      serviceRequired: true,
      definition:
        'Actor-authorized service uptime from the canonical downtime-union metrics engine.',
    },
    {
      id: 'AVAILABILITY',
      unit: 'percent',
      serviceRequired: true,
      definition: 'Alias of UPTIME in the current backend; not a request-success ratio.',
    },
    {
      id: 'MTTA',
      unit: 'minutes',
      serviceRequired: false,
      definition:
        'Arithmetic mean of valid acknowledgement SLA elapsed times; uses canonical paused-clock and rollup semantics.',
    },
    {
      id: 'MTTR',
      unit: 'minutes',
      serviceRequired: false,
      definition:
        'Arithmetic mean of valid resolution SLA elapsed times for resolved incidents; uses canonical paused-clock and rollup semantics.',
    },
  ],
  comparators: OBJECTIVE_COMPARATORS,
  windows: OBJECTIVE_WINDOWS,
  windowSemantics:
    'Elapsed rolling days. QUARTERLY is a legacy alias for 90 days and YEARLY for 365 days; neither is a calendar-boundary reset.',
  rollingDays: { minimum: 1, maximum: 3650 },
  history:
    'Immutable definition versions and existing daily scheduler snapshots are preserved. Ad-hoc evaluations are actor-scoped and do not overwrite scheduled shared history.',
  noData:
    'No measurement is not compliance. Null values produce NO_DATA and null compliance. Retention-clipped windows or unsupported legacy telemetry produce UNAVAILABLE and null compliance.',
  unsupportedCreationMetrics: ['LATENCY_P99', 'ERROR_RATE'],
} as const;
