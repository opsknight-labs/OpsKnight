import {
  OBJECTIVE_COMPARATORS,
  OBJECTIVE_WINDOWS,
  SERVICE_OBJECTIVE_METRICS,
} from '@/lib/slo/types';
import { CREATABLE_SERVICE_OBJECTIVE_METRICS } from '@/lib/slo/schemas';
import {
  SLO_ALERT_BOUNDS,
  SLO_ALERT_STATES,
  SLO_BURN_TIERS,
  SLO_BURN_WINDOWS,
} from '@/lib/slo/burn-alerts/contract';
type Schema = Record<string, unknown>;
const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const string: Schema = { type: 'string' };
const date: Schema = { type: 'string', format: 'date-time' };
const integer: Schema = { type: 'integer', minimum: 0 };
const nullableString: Schema = { type: ['string', 'null'] };
const nullableDate: Schema = { type: ['string', 'null'], format: 'date-time' };
const nullableNumber: Schema = { type: ['number', 'null'] };
const object = (
  properties: Record<string, Schema>,
  required = Object.keys(properties)
): Schema => ({ type: 'object', properties, required, additionalProperties: false });
const definitionProperties = {
  serviceId: nullableString,
  name: { type: 'string', minLength: 1, maxLength: 100 },
  description: { ...nullableString, maxLength: 500 },
  metricType: { type: 'string', enum: CREATABLE_SERVICE_OBJECTIVE_METRICS },
  target: { type: 'number', minimum: 0 },
  comparator: { type: 'string', enum: OBJECTIVE_COMPARATORS },
  windowType: { type: 'string', enum: OBJECTIVE_WINDOWS },
  windowValue: { type: ['integer', 'null'], minimum: 1, maximum: 3650 },
};
const definition = object(definitionProperties, [
  'name',
  'metricType',
  'target',
  'comparator',
  'windowType',
]);
const patch = object(
  Object.fromEntries(
    Object.entries(definitionProperties).filter(
      ([key]) => !['serviceId', 'metricType'].includes(key)
    )
  ),
  []
);
const coverage = object({
  effectiveStart: date,
  effectiveEnd: date,
  complete: { type: 'boolean' },
});
const evaluation = object(
  {
    objectiveId: string,
    metric: { type: 'string', enum: SERVICE_OBJECTIVE_METRICS },
    value: nullableNumber,
    target: { type: 'number' },
    comparator: { type: 'string', enum: OBJECTIVE_COMPARATORS },
    compliant: { type: ['boolean', 'null'] },
    breached: { type: ['boolean', 'null'] },
    sampleCount: { type: ['integer', 'null'], minimum: 0 },
    sampleCountExact: nullableString,
    elapsedSumMs: nullableString,
    periodStart: date,
    periodEnd: date,
    dataState: { type: 'string', enum: ['AVAILABLE', 'NO_DATA', 'UNAVAILABLE'] },
    definitionVersion: integer,
    coverage,
  },
  [
    'objectiveId',
    'metric',
    'value',
    'target',
    'comparator',
    'compliant',
    'breached',
    'sampleCount',
    'periodStart',
    'periodEnd',
    'dataState',
    'definitionVersion',
  ]
);
const alertState: Schema = { type: 'string', enum: SLO_ALERT_STATES };
const burnWindow: Schema = { type: 'string', enum: Object.keys(SLO_BURN_WINDOWS) };
const burnByWindow = object(
  Object.fromEntries(Object.keys(SLO_BURN_WINDOWS).map(key => [key, nullableNumber]))
);
const alertPolicyInput = object(
  {
    connectionId: { type: 'string', minLength: 1, maxLength: 64 },
    goodQuery: { type: 'string', minLength: 1, maxLength: SLO_ALERT_BOUNDS.maxQueryLength },
    totalQuery: { type: 'string', minLength: 1, maxLength: SLO_ALERT_BOUNDS.maxQueryLength },
    enabled: { type: 'boolean', default: false },
    ticketsEnabled: { type: 'boolean', default: true },
  },
  ['connectionId', 'goodQuery', 'totalQuery']
);
export const SERVICE_OBJECTIVE_SCHEMAS: Record<string, Schema> = {
  ServiceObjective: object({
    id: string,
    versionId: string,
    serviceId: nullableString,
    name: string,
    description: nullableString,
    metricType: { type: 'string', enum: SERVICE_OBJECTIVE_METRICS },
    target: { type: 'number' },
    comparator: { type: 'string', enum: OBJECTIVE_COMPARATORS },
    windowType: { type: 'string', enum: OBJECTIVE_WINDOWS },
    windowValue: { type: ['integer', 'null'] },
    version: integer,
    revision: integer,
    activeFrom: date,
    activeTo: nullableDate,
    status: { type: 'string', enum: ['ACTIVE', 'ARCHIVED'] },
    legacySlaDefinitionId: nullableString,
    createdAt: date,
  }),
  ServiceObjectiveCatalog: object({
    version: { const: 1 },
    metrics: {
      type: 'array',
      items: object({
        id: { type: 'string', enum: CREATABLE_SERVICE_OBJECTIVE_METRICS },
        unit: { type: 'string', enum: ['percent', 'minutes'] },
        serviceRequired: { type: 'boolean' },
        definition: string,
      }),
    },
    comparators: { type: 'array', items: { type: 'string', enum: OBJECTIVE_COMPARATORS } },
    windows: { type: 'array', items: { type: 'string', enum: OBJECTIVE_WINDOWS } },
    windowSemantics: string,
    rollingDays: object({ minimum: integer, maximum: integer }),
    history: string,
    noData: string,
    unsupportedCreationMetrics: {
      type: 'array',
      items: { type: 'string', enum: ['LATENCY_P99', 'ERROR_RATE'] },
    },
  }),
  ServiceObjectiveSnapshot: object({
    id: string,
    objectiveId: string,
    periodStart: date,
    periodEnd: date,
    value: nullableNumber,
    numerator: nullableString,
    denominator: nullableString,
    sampleCount: nullableString,
    target: { type: 'number' },
    breached: { type: ['boolean', 'null'] },
    dataState: { type: 'string', enum: ['AVAILABLE', 'NO_DATA', 'UNAVAILABLE'] },
    definitionVersion: integer,
    createdAt: date,
  }),
  ServiceObjectiveLegacySnapshot: object({
    id: string,
    slaDefinitionId: string,
    date,
    totalIncidents: integer,
    metAckTime: integer,
    metResolveTime: integer,
    evaluatedAckCount: integer,
    evaluatedResolveCount: integer,
    complianceScore: nullableNumber,
    denominatorUnknown: { type: 'boolean' },
    targetAckMinutes: { type: ['integer', 'null'] },
    targetResolveMinutes: { type: ['integer', 'null'] },
    definitionVersion: { type: ['integer', 'null'] },
    targetCapturedAt: nullableDate,
    targetSource: nullableString,
    createdAt: date,
  }),
  ServiceObjectiveHistoryItem: {
    oneOf: [
      object({
        source: { const: 'OBJECTIVE' },
        id: string,
        periodEnd: date,
        record: ref('ServiceObjectiveSnapshot'),
      }),
      object({
        source: { const: 'LEGACY_INCIDENT_SLA' },
        id: string,
        periodEnd: date,
        record: ref('ServiceObjectiveLegacySnapshot'),
      }),
    ],
  },
  ServiceObjectiveAlertPolicy: object({
    objectiveId: string,
    serviceId: string,
    connectionId: nullableString,
    connectionName: nullableString,
    goodQuery: string,
    totalQuery: string,
    stepSeconds: integer,
    enabled: { type: 'boolean' },
    ticketsEnabled: { type: 'boolean' },
    state: alertState,
    stateSince: date,
    lastEvaluatedAt: nullableDate,
    lastStatus: nullableString,
    lastIncidentId: nullableString,
    coverageFrom: nullableDate,
    updatedAt: date,
  }),
  ServiceObjectiveBurnHistory: object({
    objectiveId: string,
    targetPercent: { type: 'number' },
    state: alertState,
    hours: integer,
    points: {
      type: 'array',
      items: object({
        at: date,
        good: { type: 'number' },
        total: { type: 'number' },
        sli: nullableNumber,
        burn1h: nullableNumber,
      }),
    },
    transitions: {
      type: 'array',
      maxItems: SLO_ALERT_BOUNDS.maxTransitions,
      items: object({
        from: alertState,
        to: alertState,
        at: date,
        incidentId: nullableString,
        burnByWindow,
      }),
    },
    tiers: {
      type: 'array',
      maxItems: SLO_BURN_TIERS.length,
      items: object({
        tier: { type: 'string', enum: ['PAGE', 'TICKET'] },
        long: burnWindow,
        short: burnWindow,
        threshold: { type: 'number' },
      }),
    },
  }),
  ServiceObjectiveEvaluation: evaluation,
  ServiceObjectiveEvaluationReceipt: {
    oneOf: [
      object({
        outcome: { const: 'EVALUATED' },
        completedAt: date,
        evaluation: ref('ServiceObjectiveEvaluation'),
      }),
      object({ outcome: { const: 'ACCESS_REVOKED' }, completedAt: date }),
    ],
  },
  ServiceObjectiveEvaluationJob: object({
    id: { type: 'string', format: 'uuid' },
    objectiveId: string,
    versionId: string,
    status: { type: 'string', enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'] },
    attempts: integer,
    createdAt: date,
    completedAt: nullableDate,
    result: { anyOf: [ref('ServiceObjectiveEvaluationReceipt'), { type: 'null' }] },
    errorCode: { type: ['string', 'null'], enum: ['EVALUATION_FAILED', null] },
  }),
};
export const SERVICE_OBJECTIVE_OPERATIONS: {
  method: 'get' | 'post' | 'patch' | 'put';
  path: string;
  summary: string;
  description?: string;
  body?: Schema;
  query?: Record<string, Schema>;
  status?: number;
  paginated?: boolean;
}[] = [
  {
    method: 'get',
    path: '/service-objectives/catalog',
    summary: 'Inspect the supported measurement, window and immutable-history contract',
  },
  {
    method: 'get',
    path: '/service-objectives',
    summary: 'List active authorized objective definitions with bounded keyset pagination',
    paginated: true,
  },
  {
    method: 'post',
    path: '/service-objectives',
    summary: 'Create an objective after explicitly reviewing the active service/metric slot',
    status: 201,
    body: object({
      definition,
      expectedActiveVersionId: { ...nullableString, minLength: 1, maxLength: 100 },
    }),
    description:
      'Send null for an empty slot or the exact active immutable version ID to replace that slot. The legacy session-authenticated API retains its existing implicit replacement behavior through the same command. Canonical audit and replay commit with the new immutable definition.',
  },
  {
    method: 'get',
    path: '/service-objectives/{id}',
    summary: 'Read the latest objective version, including an archived lineage, with a strong ETag',
  },
  {
    method: 'patch',
    path: '/service-objectives/{id}',
    summary: 'Create a new immutable objective version using a concrete revision',
    body: { ...patch, minProperties: 1 },
  },
  {
    method: 'post',
    path: '/service-objectives/{id}/archive',
    summary: 'Retire the active version while retaining all definitions and snapshots',
    body: object({}),
  },
  {
    method: 'get',
    path: '/service-objectives/{id}/versions',
    summary: 'Page through every immutable definition version',
    paginated: true,
  },
  {
    method: 'get',
    path: '/service-objectives/{id}/snapshots',
    summary: 'Read authorized daily scheduler snapshots without precision loss',
    description:
      'Requires global metrics visibility because scheduled snapshots may include private incident contributions. Scoped readers can request actor-filtered evaluations instead.',
    paginated: true,
  },
  {
    method: 'get',
    path: '/service-objectives/{id}/history',
    summary: 'Read separately typed objective or legacy incident-SLA history',
    paginated: true,
    description:
      'Requires global metrics visibility for both history sources. Scoped readers can request actor-filtered evaluations instead. source=OBJECTIVE (default) or LEGACY_INCIDENT_SLA. Signed cursors bind to the lineage and source; legacy incident-SLA evidence is not reinterpreted as objective measurements.',
  },
  {
    method: 'post',
    path: '/service-objectives/{id}/evaluate',
    summary: 'Queue a bounded evaluation of an explicitly reviewed immutable version',
    status: 202,
    body: object(
      {
        expectedVersionId: { type: 'string', minLength: 1, maxLength: 100 },
        start: date,
        end: date,
      },
      ['expectedVersionId']
    ),
    description:
      'Required idempotency key; at most two active jobs per credential and sixteen globally. Periods must be ordered, not in the future, and at most 3650 elapsed days. The worker checks current scope, role and service access before computation and before storing the result. Ad-hoc actor-scoped results do not overwrite scheduled shared history. Retention-clipped or unsupported telemetry is UNAVAILABLE, never compliant.',
  },
  {
    method: 'get',
    path: '/service-objectives/{id}/evaluations/{evaluationId}',
    summary: 'Inspect an authorized evaluation job and its recorded outcome',
  },
  {
    method: 'get',
    path: '/service-objectives/{id}/alert-policy',
    summary: 'Read the burn-rate alert policy and current alert state of an objective',
    description:
      'Returns 404 when the objective has no policy. state is OK, TICKET or PAGE; lastStatus explains the latest evaluation (OK, NO_DATA, CONNECTOR_ERROR:<code> or a connection scope problem).',
  },
  {
    method: 'put',
    path: '/service-objectives/{id}/alert-policy',
    summary: 'Create or replace the multi-window burn-rate alert policy of an objective',
    body: alertPolicyInput,
    description:
      'Availability and uptime objectives of a service only. goodQuery and totalQuery return event counts per 5-minute step through an enabled metrics connection the service team may use. enabled defaults to false. Changing the connection or a query discards stored measurements; tiers re-arm as coverage builds. Required idempotency key; saving does no network I/O.',
  },
  {
    method: 'get',
    path: '/service-objectives/{id}/burn-history',
    summary: 'Read stored SLI steps, hourly burn, alert transitions and tier thresholds',
    query: {
      hours: {
        type: 'integer',
        minimum: 1,
        maximum: SLO_ALERT_BOUNDS.historyMaxHours,
        default: SLO_ALERT_BOUNDS.historyDefaultHours,
      },
    },
    description: `hours (1-${SLO_ALERT_BOUNDS.historyMaxHours}, default ${SLO_ALERT_BOUNDS.historyDefaultHours}) bounds the steps returned; at most ${SLO_ALERT_BOUNDS.maxTransitions} transitions.`,
  },
];
