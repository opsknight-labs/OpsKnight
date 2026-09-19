export const SERVICE_OBJECTIVE_METRICS = [
  'UPTIME',
  'AVAILABILITY',
  'MTTA',
  'MTTR',
  'LATENCY_P99',
  'ERROR_RATE',
] as const;

export const OBJECTIVE_COMPARATORS = ['GREATER_THAN_OR_EQUAL', 'LESS_THAN_OR_EQUAL'] as const;

export const OBJECTIVE_WINDOWS = [
  'SEVEN_DAYS',
  'THIRTY_DAYS',
  'NINETY_DAYS',
  'QUARTERLY',
  'YEARLY',
  'ROLLING_DAYS',
] as const;

export type ServiceObjectiveMetric = (typeof SERVICE_OBJECTIVE_METRICS)[number];
export type ObjectiveComparator = (typeof OBJECTIVE_COMPARATORS)[number];
export type ObjectiveWindow = (typeof OBJECTIVE_WINDOWS)[number];

export interface ServiceObjectiveEvaluationInput {
  id: string;
  serviceId: string | null;
  metricType: ServiceObjectiveMetric;
  target: number;
  comparator: ObjectiveComparator;
  windowType: ObjectiveWindow;
  windowValue: number | null;
  version: number;
}

export interface ServiceObjectiveEvaluation {
  objectiveId: string;
  metric: ServiceObjectiveMetric;
  value: number | null;
  target: number;
  comparator: ObjectiveComparator;
  compliant: boolean | null;
  breached: boolean | null;
  sampleCount: number | null;
  periodStart: Date;
  periodEnd: Date;
  dataState: 'AVAILABLE' | 'NO_DATA' | 'UNAVAILABLE';
  definitionVersion: number;
}
