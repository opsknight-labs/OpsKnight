export type MetricScope = 'current' | 'selected_period' | 'rolling_24h' | 'forecast_14d';

export type MetricDataState = 'available' | 'partial' | 'stale' | 'no_data' | 'unavailable';

export type MetricDirection = 'lower_is_better' | 'higher_is_better' | 'context_only';

export type MetricDefinition = {
  label: string;
  description: string;
  formula: string;
  scope: MetricScope;
  direction: MetricDirection;
};

export const INCIDENT_METRIC_DEFINITIONS = {
  totalIncidents: {
    label: 'Total incidents',
    description: 'Incidents created inside the selected reporting period.',
    formula: 'Count of incidents whose created time is inside the selected period',
    scope: 'selected_period',
    direction: 'lower_is_better',
  },
  activeIncidents: {
    label: 'Active incidents',
    description: 'Current actionable backlog: Triggered plus Acknowledged incidents.',
    formula: 'Triggered (OPEN) + Acknowledged',
    scope: 'current',
    direction: 'lower_is_better',
  },
  triggeredIncidents: {
    label: 'Triggered incidents',
    description: 'Current incidents that have not yet been acknowledged.',
    formula: 'Count of incidents in strict OPEN state',
    scope: 'current',
    direction: 'lower_is_better',
  },
  acknowledgedIncidents: {
    label: 'Acknowledged incidents',
    description: 'Current incidents acknowledged by a responder and still being worked.',
    formula: 'Count of incidents in ACKNOWLEDGED state',
    scope: 'current',
    direction: 'context_only',
  },
  mutedIncidents: {
    label: 'Muted incidents',
    description: 'Current non-actionable backlog: Snoozed plus Suppressed incidents.',
    formula: 'Snoozed + Suppressed',
    scope: 'current',
    direction: 'context_only',
  },
  resolvedIncidents: {
    label: 'Resolved incidents',
    description: 'Incidents from the selected creation-period cohort that are now resolved.',
    formula: 'Selected-period incidents whose current state is RESOLVED',
    scope: 'selected_period',
    direction: 'higher_is_better',
  },
  unassignedActive: {
    label: 'Unassigned active incidents',
    description: 'Current Active incidents without a responder assignee.',
    formula: 'Active incidents where assignee is empty',
    scope: 'current',
    direction: 'lower_is_better',
  },
  highUrgencyActive: {
    label: 'High-urgency active incidents',
    description: 'Current Active incidents with High urgency.',
    formula: 'Active incidents where urgency is HIGH',
    scope: 'current',
    direction: 'lower_is_better',
  },
  highUrgencyPeriod: {
    label: 'High-urgency incident share',
    description: 'Selected-period incidents classified as High urgency.',
    formula: 'High-urgency selected-period incidents ÷ selected-period incidents × 100',
    scope: 'selected_period',
    direction: 'lower_is_better',
  },
  resolved24h: {
    label: 'Resolved in 24 hours',
    description: 'Incidents whose resolution timestamp falls inside the last 24 hours.',
    formula: 'Count where resolvedAt is within the trailing 24-hour window',
    scope: 'rolling_24h',
    direction: 'higher_is_better',
  },
  ackRate: {
    label: 'Acknowledgment rate',
    description: 'Share of selected-period incidents that have been acknowledged.',
    formula: 'Incidents with acknowledgedAt ÷ eligible selected-period incidents × 100',
    scope: 'selected_period',
    direction: 'higher_is_better',
  },
  resolveRate: {
    label: 'Resolution rate',
    description: 'Share of the selected-period incident cohort that is resolved.',
    formula: 'Resolved selected-period incidents ÷ selected-period incidents × 100',
    scope: 'selected_period',
    direction: 'higher_is_better',
  },
  ackCompliance: {
    label: 'Acknowledgment SLA compliance',
    description: 'Share of measurable acknowledgments completed within their SLA target.',
    formula: 'Acknowledgments within target ÷ measurable acknowledgments × 100',
    scope: 'selected_period',
    direction: 'higher_is_better',
  },
  resolveCompliance: {
    label: 'Resolution SLA compliance',
    description: 'Share of measurable resolutions completed within their SLA target.',
    formula: 'Resolutions within target ÷ measurable resolutions × 100',
    scope: 'selected_period',
    direction: 'higher_is_better',
  },
  mtta: {
    label: 'MTTA',
    description: 'Mean time from incident creation to acknowledgment.',
    formula: 'Average acknowledgedAt − createdAt for acknowledged eligible incidents',
    scope: 'selected_period',
    direction: 'lower_is_better',
  },
  mttr: {
    label: 'MTTR',
    description: 'Mean time from incident creation to resolution.',
    formula: 'Average resolvedAt − createdAt for resolved eligible incidents',
    scope: 'selected_period',
    direction: 'lower_is_better',
  },
  onCallCoverage: {
    label: 'On-call coverage',
    description: 'Share of the next 14 days covered by an on-call responder.',
    formula: 'Covered schedule time ÷ total time in the next 14 days × 100',
    scope: 'forecast_14d',
    direction: 'higher_is_better',
  },
} as const satisfies Record<string, MetricDefinition>;

export type IncidentMetricDefinitionKey = keyof typeof INCIDENT_METRIC_DEFINITIONS;

const SERVER_METRIC_DEFINITION_KEYS = {
  totalIncidents: 'totalIncidents',
  activeIncidents: 'activeIncidents',
  activeCount: 'activeIncidents',
  openCount: 'triggeredIncidents',
  acknowledgedCount: 'acknowledgedIncidents',
  unassignedActive: 'unassignedActive',
  highUrgencyCount: 'highUrgencyPeriod',
  criticalCount: 'highUrgencyActive',
  resolved24h: 'resolved24h',
  ackRate: 'ackRate',
  resolveRate: 'resolveRate',
  ackCompliance: 'ackCompliance',
  resolveCompliance: 'resolveCompliance',
  mttd: 'mtta',
  mtta: 'mtta',
  mttr: 'mttr',
  coveragePercent: 'onCallCoverage',
} as const satisfies Record<string, IncidentMetricDefinitionKey>;

export function getMetricDefinition(metricKey: string): MetricDefinition | undefined {
  const definitionKey =
    SERVER_METRIC_DEFINITION_KEYS[metricKey as keyof typeof SERVER_METRIC_DEFINITION_KEYS];
  return definitionKey ? INCIDENT_METRIC_DEFINITIONS[definitionKey] : undefined;
}

export function metricScopeLabel(scope: MetricScope, selectedPeriodLabel?: string): string {
  if (scope === 'current') return 'Current';
  if (scope === 'rolling_24h') return 'Last 24h';
  if (scope === 'forecast_14d') return 'Next 14d';
  return selectedPeriodLabel || 'Selected period';
}

export function metricDefinitionTooltip(
  definition: MetricDefinition,
  selectedPeriodLabel?: string
): string {
  return `${definition.description} Formula: ${definition.formula}. Scope: ${metricScopeLabel(definition.scope, selectedPeriodLabel)}.`;
}
