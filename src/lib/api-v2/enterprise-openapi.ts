import {
  USER_ADMINISTRATION_SCHEMAS,
  USER_INVITATION_SCHEMAS,
  USER_INVITATION_OPERATIONS,
  USER_ADMINISTRATION_OPERATIONS,
  USER_NOTIFICATION_PREFERENCE_SCHEMAS,
  USER_NOTIFICATION_PREFERENCE_OPERATIONS,
} from './user-administration-openapi';
import {
  TEAM_ADMINISTRATION_SCHEMAS,
  TEAM_ADMINISTRATION_OPERATIONS,
} from './team-administration-openapi';
import {
  RUNBOOK_ADMINISTRATION_SCHEMAS,
  RUNBOOK_ADMINISTRATION_OPERATIONS,
} from './runbook-administration-openapi';
import { RUNBOOK_FLEET_SCHEMAS, RUNBOOK_FLEET_OPERATIONS } from './runbook-fleet-openapi';
import {
  RUNBOOK_INTERVENTION_SCHEMAS,
  RUNBOOK_INTERVENTION_OPERATIONS,
} from './runbook-intervention-openapi';
import {
  SERVICE_OBJECTIVE_SCHEMAS,
  SERVICE_OBJECTIVE_OPERATIONS,
} from './service-objective-openapi';
import { statusPageSectionFields } from '@/lib/status-pages/settings-sections';
import { AUTOMATION_SCHEMAS, automationDraftBody } from './automation-openapi';
import {
  NOTIFICATION_PROVIDER_SCHEMAS,
  NOTIFICATION_PROVIDER_OPERATIONS,
} from './notification-providers-openapi';
import { MAX_SELECT_OPTIONS } from '@/lib/runbooks/input-options';
import {
  RUNBOOK_INPUT_TYPES,
  RUNBOOK_STEP_TYPES,
  RUNBOOK_RISK_CLASSES,
} from '@/lib/runbooks/types';

type Schema = Record<string, unknown>;
const string = (maxLength?: number): Schema => ({
  type: 'string',
  ...(maxLength ? { maxLength } : {}),
});
const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const object = (properties: Record<string, Schema>, required: string[] = []): Schema => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
});
const id = { type: 'string', minLength: 1 };
const date = { type: 'string', format: 'date-time' };
const integer = { type: 'integer', minimum: 0 };
const array = (items: Schema, maxItems?: number): Schema => ({
  type: 'array',
  items,
  ...(maxItems !== undefined ? { maxItems } : {}),
});
const note = { ...string(1000) };
const lifecycle = object({
  note,
  expectedStatus: {
    type: 'string',
    enum: ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'SNOOZED', 'SUPPRESSED'],
  },
});

const ruleConfigurationProperties: Record<string, Schema> = {
  runbookId: id,
  name: string(200),
  runbookVersionId: id,
  enabled: { type: 'boolean' },
  mode: { type: 'string', enum: ['MANUAL', 'SUGGESTED', 'AUTOMATIC'] },
  versionStrategy: { type: 'string', enum: ['PINNED', 'LATEST_PUBLISHED'] },
  defaultAgentId: id,
  defaultAgentPoolId: id,
  agentSelector: { type: 'object', additionalProperties: string() },
  inputValues: { type: 'object', additionalProperties: {} },
};
const ruleTriggerInput = object(
  {
    event: { const: 'INCIDENT_CREATED' },
    conditionLogic: { type: 'string', enum: ['AND', 'OR'] },
    enabled: { type: 'boolean' },
    conditions: array(
      object(
        {
          field: string(),
          operator: {
            type: 'string',
            enum: [
              'EQUALS',
              'NOT_EQUALS',
              'CONTAINS',
              'STARTS_WITH',
              'IN',
              'NOT_IN',
              'EXISTS',
              'NOT_EXISTS',
            ],
          },
          value: {},
          sequence: integer,
        },
        ['field', 'operator', 'value']
      ),
      20
    ),
  },
  ['event']
);
const ruleCondition = object(
  { field: string(), operator: string(), value: {}, sequence: integer },
  ['field', 'operator', 'value', 'sequence']
);
const ruleTrigger = object(
  {
    id,
    revision: integer,
    event: string(),
    conditionLogic: string(),
    enabled: { type: 'boolean' },
    conditions: array(ruleCondition, 20),
  },
  ['id', 'revision', 'event', 'conditionLogic', 'enabled', 'conditions']
);
const authoringVersionSchema = object(
  {
    id,
    runbookId: id,
    version: { type: 'integer', minimum: 1 },
    state: { type: 'string', enum: ['DRAFT', 'PUBLISHED', 'RETIRED'] },
    checksum: string(),
    draftRevision: integer,
    publishedAt: { type: ['string', 'null'], format: 'date-time' },
    createdAt: date,
    updatedAt: date,
    steps: { type: 'array', items: ref('RunbookStep') },
  },
  [
    'id',
    'runbookId',
    'version',
    'state',
    'checksum',
    'draftRevision',
    'publishedAt',
    'createdAt',
    'updatedAt',
    'steps',
  ]
);

const statusPageSectionProperties = (section: string): Record<string, Schema> =>
  Object.fromEntries(
    [...(statusPageSectionFields(section) ?? [])]
      .filter(key => !['id', 'expectedUpdatedAt', 'customDomain', 'subdomain'].includes(key))
      .map(key => [
        key,
        key === 'branding'
          ? { type: ['object', 'null'], additionalProperties: true }
          : key === 'allowedCustomFields'
            ? { type: ['array', 'null'], items: string() }
            : key.startsWith('show') || ['enabled', 'requireAuth'].includes(key)
              ? { type: 'boolean' }
              : key.includes('Threshold')
                ? { type: 'number', minimum: 0, maximum: 100 }
                : [
                      'incidentHistoryDetailDays',
                      'maxIncidentsToShow',
                      'incidentHistoryDays',
                      'dataRetentionDays',
                    ].includes(key)
                  ? { type: ['integer', 'null'], minimum: 1 }
                  : key === 'name'
                    ? string(200)
                    : { type: ['string', 'null'] },
      ])
  );
const statusPageSectionRepresentations = Object.fromEntries(
  ['appearance', 'privacy', 'content', 'settings'].map(section => [
    `StatusPage${section[0].toUpperCase()}${section.slice(1)}`,
    object(
      {
        id,
        revision: integer,
        updatedAt: date,
        values: object(statusPageSectionProperties(section === 'settings' ? 'general' : section)),
      },
      ['id', 'revision', 'updatedAt', 'values']
    ),
  ])
);

export const ENTERPRISE_SCHEMAS: Record<string, Schema> = {
  ...RUNBOOK_ADMINISTRATION_SCHEMAS,
  ...RUNBOOK_FLEET_SCHEMAS,
  ...USER_INVITATION_SCHEMAS,
  ...USER_NOTIFICATION_PREFERENCE_SCHEMAS,
  ...NOTIFICATION_PROVIDER_SCHEMAS,
  IntegrationCredentialState: object({ id, revision: integer, routingKeyConfigured: { type: 'boolean' }, signingSecretConfigured: { type: 'boolean' }, previousRoutingKeyValidUntil: { type: ['string', 'null'], format: 'date-time' }, previousSignatureSecretValidUntil: { type: ['string', 'null'], format: 'date-time' }, updatedAt: date }, ['id', 'revision', 'routingKeyConfigured', 'signingSecretConfigured', 'previousRoutingKeyValidUntil', 'previousSignatureSecretValidUntil', 'updatedAt']),
  IntegrationCredentialRotation: object({ id, credential: { type: 'string', enum: ['routing-key', 'signature-secret'] }, secret: { type: ['string', 'null'] }, revision: integer, updatedAt: date }, ['id', 'credential', 'secret', 'revision', 'updatedAt']),
  IntegrationCreated: object({ id, name: string(100), type: string(64), serviceId: id, enabled: { type: 'boolean' }, revision: integer, createdAt: date, updatedAt: date, key: { type: ['string', 'null'], description: 'Disclosed only on the initial successful response; replay returns null.' } }, ['id', 'name', 'type', 'serviceId', 'enabled', 'revision', 'createdAt', 'updatedAt', 'key']),
  IntegrationTestResult: object({ valid: { type: 'boolean' }, provider: string(), errors: array(object({ path: string(), message: string() }, ['path', 'message']), 50) }, ['valid', 'provider', 'errors']),
  IntegrationDiagnostics: object({ id, type: string(), enabled: { type: 'boolean' }, revision: integer, configurationState: string(), deliveryCounts: object({ recent: integer, failed: integer, processing: integer }, ['recent', 'failed', 'processing']), recentDeliveries: array(object({ status: string(), createdAt: date, completedAt: { type: ['string', 'null'], format: 'date-time' }, attempt: integer }, ['status', 'createdAt', 'completedAt', 'attempt']), 10) }, ['id', 'type', 'enabled', 'revision', 'configurationState', 'deliveryCounts', 'recentDeliveries']),
  IntegrationType: object({ type: string(), direction: { const: 'INBOUND' }, authentication: array(string()), configurationFields: array(string()), testMode: { const: 'LOCAL_PAYLOAD_VALIDATION' } }, ['type', 'direction', 'authentication', 'configurationFields', 'testMode']),
  IntegrationValidation: object({ id, type: string(), valid: { type: 'boolean' }, checks: array(object({ code: string(), valid: { type: 'boolean' } }, ['code', 'valid'])), activationAllowed: { type: 'boolean' }, revision: integer }, ['id', 'type', 'valid', 'checks', 'activationAllowed', 'revision']),
  IntegrationUsage: object({ id, type: string(), service: object({ id, name: string() }, ['id', 'name']), deliveriesByStatus: { type: 'object', additionalProperties: { type: 'integer', minimum: 0 } }, automationObservations: integer, enabledServiceRunbookBindings: integer }, ['id', 'type', 'service', 'deliveriesByStatus', 'automationObservations', 'enabledServiceRunbookBindings']),
  ...USER_ADMINISTRATION_SCHEMAS,
  ...TEAM_ADMINISTRATION_SCHEMAS,
  ...RUNBOOK_INTERVENTION_SCHEMAS,
  ...SERVICE_OBJECTIVE_SCHEMAS,
  StatusPagePublicationState: object(
    {
      status: { type: 'string', enum: ['LIVE', 'PUBLISHING', 'FAILED', 'DISABLED'] },
      revision: string(),
      stale: { type: 'boolean' },
      lastError: { type: ['string', 'null'] },
    },
    ['status', 'revision']
  ),
  StatusPagePublication: object(
    { id, revision: integer, publication: ref('StatusPagePublicationState') },
    ['id', 'revision', 'publication']
  ),
  StatusPagePublicationReceipt: object(
    { outcome: string(), completedAt: date, publication: ref('StatusPagePublicationState') },
    ['outcome', 'completedAt', 'publication']
  ),
  StatusPagePublicationJob: object(
    {
      id: { type: 'string', format: 'uuid' },
      statusPageId: id,
      status: string(),
      attempts: integer,
      createdAt: date,
      completedAt: { type: ['string', 'null'], format: 'date-time' },
      result: { anyOf: [ref('StatusPagePublicationReceipt'), { type: 'null' }] },
    },
    ['id', 'statusPageId', 'status', 'attempts', 'createdAt', 'completedAt', 'result']
  ),
  StatusPageService: object(
    {
      id,
      statusPageId: id,
      serviceId: id,
      displayName: { type: ['string', 'null'] },
      order: integer,
      showOnPage: { type: 'boolean' },
      createdAt: date,
    },
    ['id', 'statusPageId', 'serviceId', 'displayName', 'order', 'showOnPage', 'createdAt']
  ),
  ...statusPageSectionRepresentations,
  StatusPageConfigurationResult: object(
    {
      updatedAt: date,
      revision: integer,
      replayed: { type: 'boolean' },
      classification: { type: 'object', additionalProperties: true },
      publication: object(
        {
          status: { type: 'string', enum: ['LIVE', 'PUBLISHING', 'FAILED', 'DISABLED'] },
          revision: string(),
          stale: { type: 'boolean' },
          lastError: { type: ['string', 'null'] },
        },
        ['status', 'revision']
      ),
    },
    ['updatedAt', 'revision', 'classification', 'publication']
  ),
  StatusPageSubscriber: object(
    {
      id,
      statusPageId: id,
      email: { type: 'string', format: 'email' },
      subscribedAt: date,
      unsubscribedAt: { type: ['string', 'null'], format: 'date-time' },
      verified: { type: 'boolean' },
      state: {
        type: 'string',
        enum: ['PENDING', 'ACTIVE', 'UNSUBSCRIBED', 'BOUNCED', 'COMPLAINED', 'SUPPRESSED'],
      },
      timezone: { type: ['string', 'null'] },
    },
    [
      'id',
      'statusPageId',
      'email',
      'subscribedAt',
      'unsubscribedAt',
      'verified',
      'state',
      'timezone',
    ]
  ),
  StatusPageSubscriberStats: object(
    {
      statusPageId: id,
      total: integer,
      states: array(object({ state: string(), count: integer }, ['state', 'count'])),
    },
    ['statusPageId', 'total', 'states']
  ),
  StatusPageSubscriptionSettings: object(
    {
      statusPageId: id,
      enabled: { type: 'boolean' },
      showSubscribe: { type: 'boolean' },
      verificationRequired: { const: true },
      publicRegistrationSeparate: { const: true },
    },
    [
      'statusPageId',
      'enabled',
      'showSubscribe',
      'verificationRequired',
      'publicRegistrationSeparate',
    ]
  ),
  ...AUTOMATION_SCHEMAS,
  AutomationValidation: object(
    {
      valid: { type: 'boolean' },
      requiresActivationReview: { const: true, type: 'boolean' },
      issues: array(ref('AutomationLintIssue')),
    },
    ['valid', 'requiresActivationReview', 'issues']
  ),
  AutomationLintIssue: object(
    {
      level: { type: 'string', enum: ['ERROR', 'WARNING'] },
      code: string(),
      message: string(),
      ruleId: string(),
      fieldKey: string(),
    },
    ['level', 'code', 'message']
  ),
  AutomationSimulation: object(
    {
      valid: { type: 'boolean' },
      durationMs: { type: 'number', minimum: 0 },
      issues: array(ref('AutomationLintIssue')),
      result: { oneOf: [ref('AutomationSimulationResult'), { type: 'null' }] },
    },
    ['valid', 'durationMs', 'issues', 'result']
  ),
  AutomationSimulationResult: object(
    {
      evaluationAt: date,
      outcome: object(
        {
          type: { type: 'string', enum: ['SERVICE_DEFAULT', 'ESCALATION_POLICY', 'NO_ESCALATION'] },
          policyId: id,
        },
        ['type']
      ),
      matchedRuleId: { type: ['string', 'null'] },
      priority: { type: ['string', 'null'] },
      tags: array(string()),
      contextStates: { type: 'object', additionalProperties: { type: 'string' } },
      rules: array(
        object(
          {
            phase: { type: 'string', enum: ['ENRICH', 'ROUTE'] },
            ruleId: string(),
            result: string(),
            conditions: array(
              object({ fieldKey: string(), operator: string(), result: string() }, [
                'fieldKey',
                'operator',
                'result',
              ])
            ),
          },
          ['phase', 'ruleId', 'result', 'conditions']
        )
      ),
    },
    ['evaluationAt', 'outcome', 'matchedRuleId', 'priority', 'tags', 'contextStates', 'rules']
  ),
  AutomationDecision: object(
    {
      incidentId: id,
      serviceId: id,
      versionId: { type: ['string', 'null'] },
      mode: { type: 'string', enum: ['DISABLED', 'SHADOW', 'LIVE'] },
      routeType: string(),
      escalationPolicyId: { type: ['string', 'null'] },
      matchedRouteRuleId: { type: ['string', 'null'] },
      basePriority: { type: ['string', 'null'] },
      finalPriority: { type: ['string', 'null'] },
      evaluationAt: date,
      createdAt: date,
    },
    [
      'incidentId',
      'serviceId',
      'versionId',
      'mode',
      'routeType',
      'escalationPolicyId',
      'matchedRouteRuleId',
      'basePriority',
      'finalPriority',
      'evaluationAt',
      'createdAt',
    ]
  ),
  AutomationObservation: object(
    {
      id,
      serviceId: id,
      integrationId: string(),
      integrationType: string(),
      fieldKey: string(),
      sourcePath: string(),
      fieldType: string(),
      unmapped: { type: 'boolean' },
      count: integer,
      firstSeenAt: date,
      lastSeenAt: date,
    },
    [
      'id',
      'serviceId',
      'integrationId',
      'integrationType',
      'fieldKey',
      'sourcePath',
      'fieldType',
      'unmapped',
      'count',
      'firstSeenAt',
      'lastSeenAt',
    ]
  ),

  AutomationVersionHealth: object(
    {
      versionId: id,
      evaluated: integer,
      same: integer,
      routeDifferent: integer,
      priorityDifferent: integer,
      noEscalationDifferent: integer,
      errors: integer,
      fallbacks: integer,
      latestEvidenceBucketDate: { type: ['string', 'null'], format: 'date-time' },
    },
    [
      'versionId',
      'evaluated',
      'same',
      'routeDifferent',
      'priorityDifferent',
      'noEscalationDifferent',
      'errors',
      'fallbacks',
      'latestEvidenceBucketDate',
    ]
  ),
  AutomationEvidenceFreshness: object(
    {
      latestEvidenceBucketDate: { type: ['string', 'null'], format: 'date-time' },
      pendingObservations: integer,
      pendingObservationsTruncated: { type: 'boolean' },
      oldestSampledPendingAgeMs: { type: ['number', 'null'], minimum: 0 },
    },
    [
      'latestEvidenceBucketDate',
      'pendingObservations',
      'pendingObservationsTruncated',
      'oldestSampledPendingAgeMs',
    ]
  ),
  AutomationReadinessPolicy: object(
    {
      minimumEvaluations: { type: 'integer', minimum: 1, maximum: 1000000 },
      maximumEvidenceAgeHours: { type: 'integer', minimum: 24, maximum: 168 },
      maximumPendingObservations: { type: 'integer', minimum: 0, maximum: 1000 },
      maximumErrorRate: { type: 'number', minimum: 0, maximum: 1 },
    },
    [
      'minimumEvaluations',
      'maximumEvidenceAgeHours',
      'maximumPendingObservations',
      'maximumErrorRate',
    ]
  ),
  AutomationReadiness: object(
    {
      settingsRevision: integer,
      policy: ref('AutomationReadinessPolicy'),
      policyValid: { type: 'boolean' },
      windowDays: { type: 'integer', const: 7 },
      evaluated: integer,
      errorRate: { type: 'number', minimum: 0 },
      latestEvidenceBucketDate: { type: ['string', 'null'], format: 'date-time' },
      evidenceAgeHours: { type: ['number', 'null'], minimum: 0 },
      sufficientRecentEvidence: { type: 'boolean' },
      pendingObservations: integer,
      pendingObservationsTruncated: { type: 'boolean' },
      backlogWithinPolicy: { type: 'boolean' },
      errorsWithinPolicy: { type: 'boolean' },
      counts: object(
        Object.fromEntries(
          [
            'evaluated',
            'same',
            'routeDifferent',
            'priorityDifferent',
            'noEscalationDifferent',
            'errors',
            'fallbacks',
          ].map(key => [key, { type: ['integer', 'null'], minimum: 0 }])
        ),
        [
          'evaluated',
          'same',
          'routeDifferent',
          'priorityDifferent',
          'noEscalationDifferent',
          'errors',
          'fallbacks',
        ]
      ),
    },
    [
      'settingsRevision',
      'policy',
      'policyValid',
      'windowDays',
      'evaluated',
      'errorRate',
      'latestEvidenceBucketDate',
      'evidenceAgeHours',
      'sufficientRecentEvidence',
      'pendingObservations',
      'pendingObservationsTruncated',
      'backlogWithinPolicy',
      'errorsWithinPolicy',
      'counts',
    ]
  ),
  AutomationConfiguration: object(
    {
      serviceId: id,
      revision: integer,
      health: object(
        {
          windowDays: { type: 'integer', const: 7 },
          active: { oneOf: [ref('AutomationVersionHealth'), { type: 'null' }] },
          candidate: { oneOf: [ref('AutomationVersionHealth'), { type: 'null' }] },
          candidateEvidenceFreshness: {
            oneOf: [ref('AutomationEvidenceFreshness'), { type: 'null' }],
          },
        },
        ['windowDays', 'active', 'candidate', 'candidateEvidenceFreshness']
      ),
      globalEnabled: { type: 'boolean' },
      mode: { type: 'string', enum: ['DISABLED', 'SHADOW', 'LIVE'] },
      effectiveMode: { type: 'string', enum: ['DISABLED', 'SHADOW', 'LIVE'] },
      activeVersionId: { type: ['string', 'null'] },
      candidateVersionId: { type: ['string', 'null'] },
      draftRevision: integer,
      activeVersion: {
        oneOf: [
          object({ id, versionNumber: integer, checksum: string(), publishedAt: date }, [
            'id',
            'versionNumber',
            'checksum',
            'publishedAt',
          ]),
          { type: 'null' },
        ],
      },
      candidateVersion: {
        oneOf: [
          object({ id, versionNumber: integer, checksum: string(), publishedAt: date }, [
            'id',
            'versionNumber',
            'checksum',
            'publishedAt',
          ]),
          { type: 'null' },
        ],
      },
    },
    [
      'serviceId',
      'revision',
      'globalEnabled',
      'health',
      'mode',
      'effectiveMode',
      'activeVersionId',
      'candidateVersionId',
      'draftRevision',
      'activeVersion',
      'candidateVersion',
    ]
  ),
  AutomationVersionSummary: object(
    {
      id,
      serviceId: id,
      versionNumber: integer,
      checksum: string(),
      sourceVersionId: { type: ['string', 'null'] },
      publishedAt: date,
      publishedBy: id,
    },
    [
      'id',
      'serviceId',
      'versionNumber',
      'checksum',
      'sourceVersionId',
      'publishedAt',
      'publishedBy',
    ]
  ),
  AutomationVersionDetail: object(
    {
      id,
      serviceId: id,
      versionNumber: integer,
      checksum: string(),
      sourceVersionId: { type: ['string', 'null'] },
      publishedAt: date,
      publishedBy: id,
      snapshot: ref('AutomationSnapshot'),
      lintReport: { type: 'array', items: { type: 'object', additionalProperties: true } },
    },
    [
      'id',
      'serviceId',
      'versionNumber',
      'checksum',
      'sourceVersionId',
      'publishedAt',
      'publishedBy',
      'snapshot',
      'lintReport',
    ]
  ),
  AutomationPublishedVersion: object(
    { id, serviceId: id, versionNumber: { type: 'integer', minimum: 1 }, checksum: string() },
    ['id', 'serviceId', 'versionNumber', 'checksum']
  ),
  AutomationCandidateVersion: object(
    {
      id,
      serviceId: id,
      versionNumber: { type: 'integer', minimum: 1 },
      publishedAt: date,
      publishedBy: id,
      checksum: string(),
      sourceVersionId: { type: ['string', 'null'] },
      lintReport: array(object({ level: string(), message: string() }, ['level', 'message']), 100),
      snapshot: { $ref: '#/components/schemas/AutomationSnapshot' },
      readiness: ref('AutomationReadiness'),
      evidenceFreshness: object(
        {
          latestEvidenceBucketDate: { type: ['string', 'null'], format: 'date-time' },
          pendingObservations: { type: 'integer', minimum: 0, maximum: 100 },
          pendingObservationsTruncated: { type: 'boolean' },
          oldestSampledPendingAgeMs: { type: ['number', 'null'], minimum: 0 },
        },
        [
          'latestEvidenceBucketDate',
          'pendingObservations',
          'pendingObservationsTruncated',
          'oldestSampledPendingAgeMs',
        ]
      ),
      shadowAggregates: object(
        {
          evaluated: integer,
          same: integer,
          routeDifferent: integer,
          priorityDifferent: integer,
          noEscalationDifferent: integer,
          errors: integer,
          fallbacks: integer,
        },
        [
          'evaluated',
          'same',
          'routeDifferent',
          'priorityDifferent',
          'noEscalationDifferent',
          'errors',
          'fallbacks',
        ]
      ),
    },
    [
      'id',
      'serviceId',
      'versionNumber',
      'publishedAt',
      'publishedBy',
      'checksum',
      'snapshot',
      'shadowAggregates',
      'evidenceFreshness',
      'readiness',
    ]
  ),
  AutomationConfig: object(
    {
      serviceId: id,
      activeVersionId: { type: ['string', 'null'] },
      candidateVersionId: { type: ['string', 'null'] },
    },
    ['serviceId']
  ),
  AutomationSettings: object(
    {
      automationEnabled: { type: 'boolean' },
      automationReadinessPolicyValid: { type: 'boolean' },
      automationStoreObservationPreviews: { type: 'boolean' },
      automationReadinessPolicy: ref('AutomationReadinessPolicy'),
      automationTraceRetentionDays: { type: 'integer', minimum: 1, maximum: 3650 },
      automationSettingsRevision: integer,
    },
    ['automationEnabled', 'automationTraceRetentionDays', 'automationSettingsRevision']
  ),
  IncidentWatcher: object({ id, incidentId: id, userId: id, role: string(), createdAt: date }, [
    'id',
    'incidentId',
    'userId',
    'role',
    'createdAt',
  ]),
  IncidentWatcherRemoved: object({ id, incidentId: id, removed: { const: true } }, [
    'id',
    'incidentId',
    'removed',
  ]),
  IncidentTag: object({ id, incidentId: id, tagId: id, createdAt: date, tag: object({ name: string(100), color: { type: ['string', 'null'] } }, ['name', 'color']) }, ['id', 'incidentId', 'tagId', 'createdAt', 'tag']),
  IncidentCustomField: object({ id, incidentId: id, customFieldId: id, value: { type: ['string', 'null'] }, createdAt: date, updatedAt: date, changed: { type: 'boolean' }, customField: object({ name: string(), key: string(), type: string() }, ['name', 'key', 'type']) }, ['id', 'incidentId', 'customFieldId', 'value', 'createdAt', 'updatedAt']),
  IncidentTemplate: object({ id, revision: integer, name: string(120), description: { type: ['string', 'null'] }, title: string(200), descriptionText: { type: ['string', 'null'] }, defaultUrgency: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] }, defaultPriority: { type: ['string', 'null'] }, defaultServiceId: { type: ['string', 'null'] }, createdById: { type: ['string', 'null'] }, isPublic: { type: 'boolean' }, createdAt: date, updatedAt: date }, ['id', 'revision', 'name', 'description', 'title', 'descriptionText', 'defaultUrgency', 'defaultPriority', 'defaultServiceId', 'createdById', 'isPublic', 'createdAt', 'updatedAt']),
  IncidentTemplateDeletion: object({ id, deleted: { const: true } }, ['id', 'deleted']),
  IncidentTagAdded: object({ id, incidentId: id, name: string(100), color: { type: ['string', 'null'] }, added: { type: 'boolean' } }, ['id', 'incidentId', 'name', 'color', 'added']),
  IncidentTagRemoved: object({ id, incidentId: id, removed: { type: 'boolean' } }, ['id', 'incidentId', 'removed']),
  RunbookCancellationRequested: object(
    { executionId: id, status: { const: 'CANCEL_REQUESTED' }, message: string() },
    ['executionId', 'status', 'message']
  ),
  RunbookExecutionPreview: object(
    {
      authorizationToken: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      digest: string(),
      expiresAt: date,
      versionId: id,
      version: integer,
      checksum: string(),
      agentId: { type: ['string', 'null'] },
      agentPoolId: { type: ['string', 'null'] },
      timeoutSeconds: integer,
      readiness: {
        type: 'array',
        items: object(
          { state: { type: 'string', enum: ['passed', 'blocked', 'deferred'] }, message: string() },
          ['state', 'message']
        ),
      },
      steps: {
        type: 'array',
        items: object(
          {
            key: string(),
            name: string(),
            type: string(),
            risk: string(),
            purpose: string(),
            requiresApproval: { type: 'boolean' },
            timeoutSeconds: integer,
          },
          ['key', 'name', 'type', 'risk', 'purpose', 'requiresApproval', 'timeoutSeconds']
        ),
      },
    },
    [
      'digest',
      'versionId',
      'version',
      'checksum',
      'agentId',
      'agentPoolId',
      'timeoutSeconds',
      'steps',
    ]
  ),
  ScheduleParticipantMutation: object(
    {
      scheduleId: id,
      layerId: id,
      userId: id,
      layerName: string(),
      userName: string(),
      assignmentId: id,
      position: integer,
      direction: { type: 'string', enum: ['up', 'down'] },
      removed: { type: 'boolean' },
    },
    ['scheduleId', 'layerId', 'userId']
  ),
  IncidentLifecycleResult: object(
    {
      incidentId: id,
      command: { type: ['string', 'null'] },
      source: string(),
      previousStatus: string(),
      status: string(),
      changed: { type: 'boolean' },
    },
    ['incidentId', 'command', 'source', 'previousStatus', 'status', 'changed']
  ),
  RunbookDefinitionInput: object(
    {
      steps: { type: 'array', minItems: 1, maxItems: 50, items: ref('RunbookStepInput') },
      description: string(5000),
      defaultTimeoutSeconds: { type: 'integer', minimum: 1, maximum: 86400 },
      defaultMaxRetries: { type: 'integer', minimum: 0, maximum: 10 },
    },
    ['steps']
  ),
  RunbookStepInput: object(
    {
      key: { ...string(80), minLength: 1, pattern: '^[a-z0-9_-]+$' },
      name: { ...string(200), minLength: 1 },
      type: { type: 'string', enum: [...RUNBOOK_STEP_TYPES] },
      riskClass: { type: 'string', enum: [...RUNBOOK_RISK_CLASSES] },
      description: string(2000),
      config: { type: 'object', additionalProperties: true },
      verification: object(
        {
          steps: { type: 'array', minItems: 1, maxItems: 10, items: ref('RunbookStepInput') },
          delaySeconds: { type: 'integer', minimum: 0, maximum: 300 },
        },
        ['steps']
      ),
      precheck: object(
        { steps: { type: 'array', minItems: 1, maxItems: 10, items: ref('RunbookStepInput') } },
        ['steps']
      ),
      timeoutSeconds: { type: 'integer', minimum: 1, maximum: 86400 },
      maxRetries: { type: 'integer', minimum: 0, maximum: 10 },
      requiresApproval: { type: 'boolean' },
    },
    ['key', 'name', 'type']
  ),
  RunbookInputDefinition: object(
    {
      key: { ...string(80), minLength: 1, pattern: '^[a-z0-9_]+$' },
      label: { ...string(200), minLength: 1 },
      type: { type: 'string', enum: [...RUNBOOK_INPUT_TYPES] },
      required: { type: 'boolean' },
      defaultValue: string(2000),
      description: string(1000),
      sequence: integer,
      options: {
        type: 'array',
        maxItems: MAX_SELECT_OPTIONS,
        items: { type: 'string', minLength: 1, maxLength: 200 },
      },
    },
    ['key', 'label']
  ),
  ServiceRunbookRuleSummary: object(
    {
      id,
      serviceId: id,
      runbookId: id,
      name: string(200),
      configurationRevision: integer,
      enabled: { type: 'boolean' },
      mode: { type: 'string', enum: ['MANUAL', 'SUGGESTED', 'AUTOMATIC'] },
      versionStrategy: { type: 'string', enum: ['PINNED', 'LATEST_PUBLISHED'] },
      runbookVersionId: { type: ['string', 'null'] },
      createdAt: date,
      updatedAt: date,
    },
    [
      'id',
      'serviceId',
      'runbookId',
      'name',
      'configurationRevision',
      'enabled',
      'mode',
      'versionStrategy',
      'runbookVersionId',
      'createdAt',
      'updatedAt',
    ]
  ),
  ServiceRunbookRule: object(
    {
      ...ruleConfigurationProperties,
      id,
      serviceId: id,
      runbookVersionId: { type: ['string', 'null'] },
      resolvedVersionId: { type: ['string', 'null'] },
      defaultAgentId: { type: ['string', 'null'] },
      defaultAgentPoolId: { type: ['string', 'null'] },
      configurationRevision: integer,
      createdAt: date,
      updatedAt: date,
      triggers: array(ruleTrigger),
    },
    [
      'id',
      'serviceId',
      'runbookId',
      'name',
      'configurationRevision',
      'enabled',
      'mode',
      'versionStrategy',
      'runbookVersionId',
      'resolvedVersionId',
      'defaultAgentId',
      'defaultAgentPoolId',
      'agentSelector',
      'inputValues',
      'createdAt',
      'updatedAt',
      'triggers',
    ]
  ),
  RunbookRuleReadiness: object(
    {
      ruleId: id,
      configurationRevision: integer,
      readiness: object(
        {
          state: {
            type: 'string',
            enum: ['PAUSED', 'BLOCKED', 'CHECKS_REQUIRED', 'CONFIGURATION_VALID', 'UNKNOWN'],
          },
          checkedAt: date,
          eligibleAgents: { type: ['integer', 'null'], minimum: 0 },
          armed: { type: 'boolean' },
          checks: array(
            object(
              {
                code: string(),
                state: { type: 'string', enum: ['passed', 'blocked', 'deferred'] },
                message: string(),
              },
              ['code', 'state', 'message']
            )
          ),
        },
        ['state', 'checkedAt', 'eligibleAgents', 'armed', 'checks']
      ),
    },
    ['ruleId', 'configurationRevision', 'readiness']
  ),
  RunbookRulePolicyCheck: object(
    {
      id,
      ruleId: id,
      agentId: id,
      versionId: id,
      checksum: string(),
      status: string(),
      expiresAt: date,
      checkedAt: { type: ['string', 'null'], format: 'date-time' },
      createdAt: date,
    },
    [
      'id',
      'ruleId',
      'agentId',
      'versionId',
      'checksum',
      'status',
      'expiresAt',
      'checkedAt',
      'createdAt',
    ]
  ),
  RunbookRulePolicyRequest: object(
    {
      saved: { const: true },
      checkedTargets: integer,
      checkIds: array(id, 100),
      status: { const: 'PENDING' },
    },
    ['saved', 'checkedTargets', 'checkIds', 'status']
  ),
  RunbookVersionDiff: object(
    {
      base: object({ version: integer, checksum: string() }, ['version', 'checksum']),
      next: object({ version: integer, checksum: string() }, ['version', 'checksum']),
      steps: array(
        object(
          {
            key: string(),
            change: { type: 'string', enum: ['ADDED', 'REMOVED', 'CHANGED', 'UNCHANGED'] },
            risk: { type: ['string', 'null'] },
            before: { anyOf: [ref('RunbookDiffStep'), { type: 'null' }] },
            after: { anyOf: [ref('RunbookDiffStep'), { type: 'null' }] },
          },
          ['key', 'change', 'risk', 'before', 'after']
        )
      ),
      inputKeys: object({ added: array(string()), removed: array(string()) }, ['added', 'removed']),
      rules: array(
        object(
          {
            id,
            name: string(),
            serviceId: id,
            enabled: { type: 'boolean' },
            mode: string(),
            versionStrategy: string(),
            runbookVersionId: { type: ['string', 'null'] },
            impact: string(),
          },
          [
            'id',
            'name',
            'serviceId',
            'enabled',
            'mode',
            'versionStrategy',
            'runbookVersionId',
            'impact',
          ]
        ),
        500
      ),
      rulesTruncated: { type: 'boolean' },
      warning: string(),
    },
    ['base', 'next', 'steps', 'inputKeys', 'rules', 'rulesTruncated', 'warning']
  ),
  RunbookDiffStep: object(
    {
      key: string(),
      name: string(),
      type: string(),
      riskClass: string(),
      requiresApproval: { type: 'boolean' },
    },
    ['key', 'name', 'type', 'riskClass', 'requiresApproval']
  ),
  RunbookMetadata: object(
    {
      id,
      name: string(200),
      slug: string(120),
      description: string(5000),
      ownerTeamId: { type: ['string', 'null'] },
      tags: array(string(40), 20),
      archivedAt: { type: ['string', 'null'], format: 'date-time' },
      publishedVersionId: { type: ['string', 'null'] },
      draftVersionId: { type: ['string', 'null'] },
      revision: { type: 'integer', minimum: 1 },
      createdAt: date,
      updatedAt: date,
    },
    [
      'id',
      'name',
      'slug',
      'description',
      'ownerTeamId',
      'tags',
      'archivedAt',
      'publishedVersionId',
      'draftVersionId',
      'revision',
      'createdAt',
      'updatedAt',
    ]
  ),
  RunbookDeleteEligibility: object(
    {
      canDelete: { type: 'boolean' },
      reason: string(),
      hasExecutions: { type: 'boolean' },
      hasBindings: { type: 'boolean' },
      hasPublishedVersions: { type: 'boolean' },
      executionCount: integer,
      bindingCount: integer,
      publishedVersionCount: integer,
    },
    [
      'canDelete',
      'hasExecutions',
      'hasBindings',
      'hasPublishedVersions',
      'executionCount',
      'bindingCount',
      'publishedVersionCount',
    ]
  ),
  RunbookAuthoringVersion: authoringVersionSchema,
  RunbookDraftRead: object(
    {
      ...(authoringVersionSchema.properties as Record<string, Schema>),
      editable: object(
        {
          definition: ref('RunbookDefinitionInput'),
          inputs: { type: 'array', items: ref('RunbookInputDefinition') },
          preserveConfiguration: { const: true },
        },
        ['definition', 'inputs', 'preserveConfiguration']
      ),
    },
    [...(authoringVersionSchema.required as string[]), 'editable']
  ),
  RunbookCreated: object(
    {
      id,
      name: string(),
      slug: string(),
      description: string(),
      draftVersionId: id,
      draftVersion: ref('RunbookAuthoringVersion'),
    },
    ['id', 'name', 'slug', 'description', 'draftVersionId', 'draftVersion']
  ),
  RunbookDraftValidation: object(
    {
      valid: { const: true },
      versionId: id,
      draftRevision: integer,
      checksum: string(),
    },
    ['valid', 'versionId', 'draftRevision', 'checksum']
  ),
  ReportCatalog: object({
    metrics: array(object({
      key: string(), label: string(), description: string(), formula: string(),
      scope: string(), direction: string(),
    }), 16),
    dimensions: array(string(), 1),
    windowDays: object({ min: integer, max: integer, default: integer }, ['min', 'max', 'default']),
  }, ['metrics', 'dimensions', 'windowDays']),
  ReportQueryResult: object({
    windowDays: integer, serviceId: { type: ['string', 'null'] },
    effectiveStart: date, effectiveEnd: date, isClipped: { type: 'boolean' },
    metrics: { type: 'object', additionalProperties: { type: ['number', 'null'] } },
  }, ['windowDays', 'serviceId', 'effectiveStart', 'effectiveEnd', 'isClipped', 'metrics']),
  SavedReport: object({
    id, revision: integer, name: string(200), description: { type: ['string', 'null'] },
    metricKeys: array(string(), 16), windowDays: { type: 'integer', minimum: 1, maximum: 90 },
    serviceId: { type: ['string', 'null'] },
    visibility: { type: 'string', enum: ['PRIVATE', 'TEAM', 'PUBLIC'] },
    userId: id, teamId: { type: ['string', 'null'] },
    createdAt: date, updatedAt: date, canEdit: { type: 'boolean' },
  }, ['id', 'revision', 'name', 'description', 'metricKeys', 'windowDays', 'serviceId', 'visibility', 'userId', 'teamId', 'createdAt', 'updatedAt']),
  ReportDashboardWidget: object({
    id, dashboardId: id, widgetType: string(100), metricKey: string(100),
    widgetDefinitionId: { type: ['string', 'null'] }, title: { type: ['string', 'null'] },
    position: { type: 'object' }, config: { type: 'object' },
    createdAt: date, updatedAt: date,
  }),
  ReportDashboardSummary: object({
    id, revision: integer, name: string(200), description: { type: ['string', 'null'] },
    visibility: { type: 'string', enum: ['PRIVATE', 'TEAM', 'PUBLIC'] },
    isDefault: { type: 'boolean' }, isTemplate: { type: 'boolean' },
    templateId: { type: ['string', 'null'] }, userId: id, teamId: { type: ['string', 'null'] },
    widgetCount: integer, createdAt: date, updatedAt: date,
  }),
  ReportDashboard: object({
    id, revision: integer, name: string(200), description: { type: ['string', 'null'] },
    visibility: { type: 'string', enum: ['PRIVATE', 'TEAM', 'PUBLIC'] },
    isDefault: { type: 'boolean' }, isTemplate: { type: 'boolean' },
    templateId: { type: ['string', 'null'] }, userId: id, teamId: { type: ['string', 'null'] },
    layout: { type: 'object' }, config: { type: ['object', 'null'] },
    widgets: array(ref('ReportDashboardWidget'), 50),
    user: object({ id, name: { type: ['string', 'null'] } }, ['id']),
    team: { type: ['object', 'null'], properties: { id, name: string() }, required: ['id', 'name'] },
    permissions: object({ canEdit: { type: 'boolean' }, canDelete: { type: 'boolean' } }, ['canEdit', 'canDelete']),
    createdAt: date, updatedAt: date,
  }),
  ReportDashboardData: object({
    dashboardId: id, windowDays: { type: 'integer', minimum: 1, maximum: 90 },
    serviceId: { type: ['string', 'null'] }, generatedAt: date,
    metrics: { type: 'object', description: 'Actor-scoped serialized SLA metrics for the requested window.' },
  }, ['dashboardId', 'windowDays', 'serviceId', 'generatedAt', 'metrics']),
  ReportDashboardWidgets: object({
    dashboardId: id, widgets: array(ref('ReportDashboardWidget'), 50),
  }, ['dashboardId', 'widgets']),
  ReportExport: object({
    id, status: { type: 'string', enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED'] },
    query: object({ metrics: array(string(), 16), windowDays: integer, serviceId: string() }, ['metrics', 'windowDays']),
    createdAt: date, expiresAt: date, completedAt: { type: ['string', 'null'], format: 'date-time' },
    failedAt: { type: ['string', 'null'], format: 'date-time' },
    checksum: { type: ['string', 'null'] }, sizeBytes: { type: ['integer', 'null'] },
  }, ['id', 'status', 'query', 'createdAt', 'expiresAt']),
  ReportExportCancellation: object({ id, status: { const: 'CANCELLED' } }, ['id', 'status']),
};

const draftInput = object(
  {
    definition: ref('RunbookDefinitionInput'),
    inputs: { type: 'array', maxItems: 30, items: ref('RunbookInputDefinition') },
  },
  ['definition']
);

interface Operation {
  method: 'get' | 'post' | 'patch' | 'put' | 'delete';
  path: string;
  summary: string;
  description?: string;
  body?: Schema;
  status?: number;
  paginated?: boolean;
}
const operations: Operation[] = [
  { method: 'get', path: '/integrations/types', summary: 'List safe supported inbound provider types and configuration capabilities' },
  {
    method: 'post', path: '/services/{id}/integrations', summary: 'Create a service inbound integration and disclose its API key once',
    description: 'Requires integrations:create and an Idempotency-Key. The response contains the initial bearer key once; replay returns safe metadata with key null. Secrets are never stored in audit details.',
    body: object({ name: string(100), type: string(64), snsTopicArn: string(512) }, ['name']),
  },
  { method: 'get', path: '/integrations/{id}/credentials', summary: 'Read signing credential state without secret material' },
  {
    method: 'post', path: '/integrations/{id}/credentials', summary: 'Rotate an integration signing secret with bounded overlap',
    description: 'Requires concrete If-Match and Idempotency-Key. Choose routing-key or signature-secret. Replacement material is disclosed once and never stored in replay receipts. Previous encrypted credentials are accepted only until the overlap deadline.',
    body: object({ credential: { type: 'string', enum: ['routing-key', 'signature-secret'], default: 'signature-secret' }, overlapSeconds: { type: 'integer', minimum: 0, maximum: 86400, default: 3600 } }),
  },
  { method: 'post', path: '/integrations/{id}/test', summary: 'Validate a bounded sample payload without ingesting an event', body: object({ payload: {} }) },
  { method: 'get', path: '/integrations/{id}/diagnostics', summary: 'Read bounded integration delivery health and safe diagnostics' },
  { method: 'post', path: '/integrations/{id}/validate', summary: 'Validate stored integration configuration without activation' },
  { method: 'get', path: '/integrations/{id}/usage', summary: 'Inspect service, delivery, observation and enabled runbook usage' },
  { method: 'delete', path: '/integrations/{id}', summary: 'Disable and safely delete an integration when no deliveries are in flight' },
  ...RUNBOOK_ADMINISTRATION_OPERATIONS,
  ...RUNBOOK_FLEET_OPERATIONS,
  ...USER_INVITATION_OPERATIONS,
  ...USER_NOTIFICATION_PREFERENCE_OPERATIONS,
  ...NOTIFICATION_PROVIDER_OPERATIONS,
  ...USER_ADMINISTRATION_OPERATIONS,
  ...TEAM_ADMINISTRATION_OPERATIONS,
  ...RUNBOOK_INTERVENTION_OPERATIONS,
  ...SERVICE_OBJECTIVE_OPERATIONS,
  {
    method: 'get',
    path: '/status-pages/{id}/publication',
    summary: 'Inspect current persisted publication state separately from configuration',
  },
  {
    method: 'post',
    path: '/status-pages/{id}/publication/retry',
    summary: 'Queue durable publication reconciliation without loosening privacy withdrawal',
    status: 202,
    body: object({}),
    description:
      'Returns a persisted job and Location. Matching keys bind body and concrete If-Match revision. Distinct keys coalesce into pending work, which reads the latest configuration when claimed. New requests wait while page work is processing. Admission permits at most four active jobs per credential and sixteen globally; capacity returns 429 with Retry-After. Inspect job result and current publication; completion can report FAILED publication. lastError contains a stable safe diagnostic code, never stored transport error text. Queue retries preserve a single canonical audit receipt.',
  },
  {
    method: 'get',
    path: '/status-pages/{id}/publication/jobs/{jobId}',
    summary: 'Inspect a page-owned publication retry job without internal queue payloads',
  },
  {
    method: 'get',
    path: '/status-pages/{id}/services',
    summary:
      'List configured service components with cursor pagination and a page configuration ETag',
    paginated: true,
  },
  {
    method: 'put',
    path: '/status-pages/{id}/services',
    summary: 'Replace reviewed service component membership and presentation',
    body: object(
      {
        serviceIds: { type: 'array', items: id, maxItems: 10000, uniqueItems: true },
        serviceConfigs: {
          type: 'object',
          additionalProperties: object({
            displayName: { type: ['string', 'null'], maxLength: 200 },
            order: { type: 'integer', minimum: 0, maximum: 100000 },
            showOnPage: { type: 'boolean' },
          }),
        },
      },
      ['serviceIds']
    ),
  },
  {
    method: 'patch',
    path: '/status-pages/{id}/services/{serviceId}',
    summary: 'Update a selected service component without changing other memberships',
    body: object({
      displayName: { type: ['string', 'null'], maxLength: 200 },
      order: { type: 'integer', minimum: 0, maximum: 100000 },
      showOnPage: { type: 'boolean' },
    }),
  },
  {
    method: 'get',
    path: '/status-pages/{id}/appearance',
    summary: 'Read status-page appearance with a strong configuration revision',
  },
  {
    method: 'patch',
    path: '/status-pages/{id}/appearance',
    summary: 'Update reviewed status-page appearance through the canonical publication command',
    description:
      'Requires a concrete If-Match configuration revision. Requires an Idempotency-Key; committed configuration metadata replays without a second audit. New keys with stale validators return 412. Publication status is read after commit and can advance on replay. Privacy narrowing withdraws the old projection before publication. A saved configuration does not imply LIVE publication. Domain claims and inline secret/provider settings are not accepted here.',
    body: object(statusPageSectionProperties('appearance')),
  },
  {
    method: 'get',
    path: '/status-pages/{id}/privacy',
    summary: 'Read status-page privacy with a strong configuration revision',
  },
  {
    method: 'patch',
    path: '/status-pages/{id}/privacy',
    summary: 'Update reviewed status-page privacy through the canonical publication command',
    description:
      'Requires a concrete If-Match configuration revision. Requires an Idempotency-Key; committed configuration metadata replays without a second audit. New keys with stale validators return 412. Publication status is read after commit and can advance on replay. Privacy narrowing withdraws the old projection before publication. A saved configuration does not imply LIVE publication. Domain claims and inline secret/provider settings are not accepted here.',
    body: object(statusPageSectionProperties('privacy')),
  },
  {
    method: 'get',
    path: '/status-pages/{id}/content',
    summary: 'Read status-page content with a strong configuration revision',
  },
  {
    method: 'patch',
    path: '/status-pages/{id}/content',
    summary: 'Update reviewed status-page content through the canonical publication command',
    description:
      'Requires a concrete If-Match configuration revision. Requires an Idempotency-Key; committed configuration metadata replays without a second audit. New keys with stale validators return 412. Publication status is read after commit and can advance on replay. Privacy narrowing withdraws the old projection before publication. A saved configuration does not imply LIVE publication. Domain claims and inline secret/provider settings are not accepted here.',
    body: object(statusPageSectionProperties('content')),
  },
  {
    method: 'get',
    path: '/status-pages/{id}/settings',
    summary: 'Read status-page settings with a strong configuration revision',
  },
  {
    method: 'patch',
    path: '/status-pages/{id}/settings',
    summary: 'Update reviewed status-page settings through the canonical publication command',
    description:
      'Requires a concrete If-Match configuration revision. Requires an Idempotency-Key; committed configuration metadata replays without a second audit. New keys with stale validators return 412. Publication status is read after commit and can advance on replay. Privacy narrowing withdraws the old projection before publication. A saved configuration does not imply LIVE publication. Domain claims and inline secret/provider settings are not accepted here.',
    body: object(statusPageSectionProperties('general')),
  },
  {
    method: 'get',
    path: '/status-pages/{id}/subscribers',
    summary: 'List subscriber contacts with explicit administrator privacy scope',
    paginated: true,
    description:
      'No verification/unsubscribe tokens, phone numbers, preferences or provider details are returned. Public consent flows remain separate.',
  },
  {
    method: 'get',
    path: '/status-pages/{id}/subscribers/{subscriberId}',
    summary: 'Read a page-scoped subscriber with explicit privacy permission',
  },
  {
    method: 'delete',
    path: '/status-pages/{id}/subscribers/{subscriberId}',
    summary: 'Revoke a subscription and suppress pending notifications',
    status: 204,
    description:
      'Does not erase consent/history or enroll recipients. Durable replay and canonical audit are atomic with revocation; repeated removal does not repeat audit.',
  },
  {
    method: 'get',
    path: '/status-pages/{id}/subscriber-stats',
    summary: 'Read consistent subscriber state counts for one page',
  },
  {
    method: 'get',
    path: '/status-pages/{id}/subscription-settings',
    summary: 'Read supported public subscription availability and verification behavior',
  },

  {
    method: 'get',
    path: '/services/{id}/runbook-rules',
    summary: 'List bounded service runbook rule summaries',
    description:
      'Requires an explicit runbook-rules scope and administrator runbook-management capability. Configuration includes reviewed input values and secret references; no secret plaintext is resolved. Parent IDs are validated. ',
    status: 200,
    paginated: true,
  },
  {
    method: 'post',
    path: '/services/{id}/runbook-rules',
    summary: 'Create a service runbook rule with a reviewed version',
    description:
      'Requires an explicit runbook-rules scope and administrator runbook-management capability. Configuration includes reviewed input values and secret references; no secret plaintext is resolved. Parent IDs are validated. ',
    status: 201,
    body: object(
      {
        configuration: object(ruleConfigurationProperties, ['runbookId']),
        trigger: ruleTriggerInput,
        expectedVersionId: id,
      },
      ['configuration', 'expectedVersionId']
    ),
  },
  {
    method: 'get',
    path: '/services/{id}/runbook-rules/{ruleId}',
    summary: 'Read privileged rule configuration and its revision',
    description:
      'Requires an explicit runbook-rules scope and administrator runbook-management capability. Configuration includes reviewed input values and secret references; no secret plaintext is resolved. Parent IDs are validated. ',
    status: 200,
  },
  {
    method: 'patch',
    path: '/services/{id}/runbook-rules/{ruleId}',
    summary: 'Update rule configuration with revision protection',
    description:
      'Requires an explicit runbook-rules scope and administrator runbook-management capability. Configuration includes reviewed input values and secret references; no secret plaintext is resolved. Parent IDs are validated. ',
    status: 200,
    body: object(
      {
        configuration: {
          ...object(
            Object.fromEntries(
              Object.entries(ruleConfigurationProperties).filter(([key]) => key !== 'runbookId')
            )
          ),
          minProperties: 1,
          properties: {
            ...Object.fromEntries(
              Object.entries(ruleConfigurationProperties).filter(([key]) => key !== 'runbookId')
            ),
            runbookVersionId: { type: ['string', 'null'] },
            defaultAgentId: { type: ['string', 'null'] },
            defaultAgentPoolId: { type: ['string', 'null'] },
          },
        },
        expectedVersionId: id,
      },
      ['configuration', 'expectedVersionId']
    ),
  },
  {
    method: 'delete',
    path: '/services/{id}/runbook-rules/{ruleId}',
    summary: 'Detach a rule while preserving execution and suggestion evidence',
    description:
      'Requires an explicit runbook-rules scope and administrator runbook-management capability. Configuration includes reviewed input values and secret references; no secret plaintext is resolved. Parent IDs are validated. ',
    status: 204,
    body: object({}),
  },
  {
    method: 'post',
    path: '/services/{id}/runbook-rules/{ruleId}/validate',
    summary: 'Review saved rule readiness without starting work',
    description:
      'Requires an explicit runbook-rules scope and administrator runbook-management capability. Configuration includes reviewed input values and secret references; no secret plaintext is resolved. Parent IDs are validated. Read-only evaluation of the saved rule as enabled; activation rechecks current evidence. No incidents, executions, notifications or policy-check requests are created.',
    status: 200,
    body: object({}),
  },
  {
    method: 'get',
    path: '/services/{id}/runbook-rules/{ruleId}/policy-checks',
    summary: 'List safe Agent policy-check status metadata',
    description:
      'Requires an explicit runbook-rules scope and administrator runbook-management capability. Configuration includes reviewed input values and secret references; no secret plaintext is resolved. Parent IDs are validated. ',
    status: 200,
    paginated: true,
  },
  {
    method: 'post',
    path: '/services/{id}/runbook-rules/{ruleId}/policy-checks',
    summary: 'Request durable Agent policy checks for the reviewed rule',
    description:
      'Requires an explicit runbook-rules scope and administrator runbook-management capability. Configuration includes reviewed input values and secret references; no secret plaintext is resolved. Parent IDs are validated. Creates bounded durable local-policy requests, not executions. Poll the policy-check list; request acceptance is not policy approval. Results exclude frozen action configuration and Agent output.',
    status: 202,
    body: object({}),
  },
  {
    method: 'post',
    path: '/services/{id}/runbook-rules/{ruleId}/activate',
    summary: 'Activate an Automatic rule using current readiness and policy evidence',
    description:
      'Requires an explicit runbook-rules scope and administrator runbook-management capability. Configuration includes reviewed input values and secret references; no secret plaintext is resolved. Parent IDs are validated. Only paused Automatic rules with immutable pins, current target policy evidence and reviewed trigger configuration can activate.',
    status: 200,
    body: object({ confirmMatchAll: { type: 'boolean', default: false } }),
  },
  {
    method: 'post',
    path: '/services/{id}/runbook-rules/{ruleId}/pause',
    summary: 'Pause new rule-triggered work',
    description:
      'Requires an explicit runbook-rules scope and administrator runbook-management capability. Configuration includes reviewed input values and secret references; no secret plaintext is resolved. Parent IDs are validated. ',
    status: 200,
    body: object({}),
  },
  {
    method: 'post',
    path: '/services/{id}/runbook-rules/{ruleId}/duplicate',
    summary: 'Duplicate a rule into an independent paused configuration',
    description:
      'Requires an explicit runbook-rules scope and administrator runbook-management capability. Configuration includes reviewed input values and secret references; no secret plaintext is resolved. Parent IDs are validated. If-Match identifies the source rule; the response ETag identifies the independent disabled copy.',
    status: 201,
    body: object({}),
  },
  {
    method: 'put',
    path: '/services/{id}/runbook-rules/{ruleId}/triggers',
    summary: 'Replace the reviewed incident trigger and pause Automatic execution',
    description:
      'Requires an explicit runbook-rules scope and administrator runbook-management capability. Configuration includes reviewed input values and secret references; no secret plaintext is resolved. Parent IDs are validated. Replaces the effective event configuration: at most one enabled trigger per rule/event is enforced by PostgreSQL. Disabled historical trigger identities are preserved; configuration replacement pauses Automatic rules. ',
    status: 200,
    body: ruleTriggerInput,
  },

  {
    method: 'get',
    path: '/runbooks/{id}/versions/{versionId}/diff',
    summary: 'Compare two versions with redacted step summaries and bounded service-rule impact',
    description:
      'Requires baseVersionId from the same runbook. Reuses UI comparison logic; executable configuration, input defaults and secret references are excluded.',
  },

  {
    method: 'get',
    path: '/runbooks/{id}/metadata',
    summary: 'Read privileged metadata and revision, including unpublished or archived runbooks',
    description:
      'Requires administrative runbook management and runbooks:write. Never returns version configuration or secret values.',
  },
  {
    method: 'patch',
    path: '/runbooks/{id}',
    summary: 'Update runbook metadata under its concrete revision',
    body: {
      ...object({
        name: string(200),
        slug: { ...string(120), pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' },
        description: string(5000),
        ownerTeamId: { type: ['string', 'null'] },
        tags: array(string(40), 20),
      }),
      minProperties: 1,
    },
  },
  {
    method: 'get',
    path: '/runbooks/{id}/delete-check',
    summary: 'Inspect references preventing permanent deletion',
    description: 'Advisory snapshot only; deletion rechecks under the parent lock.',
  },
  {
    method: 'post',
    path: '/runbooks/{id}/archive',
    summary: 'Archive a runbook, disable bindings and dismiss outstanding suggestions',
    body: object({}),
  },
  {
    method: 'post',
    path: '/runbooks/{id}/restore',
    summary: 'Restore an archived runbook while retaining disabled bindings',
    body: object({}),
  },
  {
    method: 'post',
    path: '/runbooks/{id}/duplicate',
    summary: 'Duplicate the reviewed runbook into an independent editable draft',
    status: 201,
    body: object({}),
    description:
      'If-Match identifies the source metadata revision. The result and ETag identify the new copy. Published source versions remain immutable.',
  },
  {
    method: 'delete',
    path: '/runbooks/{id}',
    summary: 'Delete a never-published draft without executions or bindings',
    status: 204,
    body: object({ confirmationText: { ...string(200), minLength: 1 } }, ['confirmationText']),
  },

  {
    method: 'post',
    path: '/services/{id}/automation/validate',
    summary: 'Validate a draft without saving or publishing',
    body: object({ snapshot: ref('AutomationSnapshot') }, ['snapshot']),
  },
  {
    method: 'post',
    path: '/services/{id}/automation/simulate',
    summary: 'Simulate automation without operational side effects',
    description:
      'Uses the production evaluator. Explanations contain outcomes and condition truth states, never received values or raw provider payloads.',
    body: object(
      {
        snapshot: ref('AutomationSnapshot'),
        integrationType: { ...string(64), minLength: 1 },
        integrationId: id,
        evaluationAt: date,
        providerPayload: {},
        event: object(
          {
            event_action: { type: 'string', enum: ['trigger', 'resolve', 'acknowledge'] },
            dedup_key: string(512),
            payload: object(
              {
                summary: { ...string(500), minLength: 1 },
                source: { ...string(500), minLength: 1 },
                severity: { type: 'string', enum: ['critical', 'error', 'warning', 'info'] },
                custom_details: {},
              },
              ['summary', 'source', 'severity']
            ),
          },
          ['event_action', 'dedup_key', 'payload']
        ),
      },
      ['snapshot', 'integrationType', 'event']
    ),
  },
  {
    method: 'post',
    path: '/services/{id}/automation/restore',
    summary: 'Restore a historical version as an editable draft',
    description:
      'Requires the current draft ETag and team edit permission. Does not publish or change active/candidate versions or operational mode.',
    body: object({ sourceVersionId: id }, ['sourceVersionId']),
  },
  {
    method: 'get',
    path: '/services/{id}/automation/decisions',
    summary: 'List pinned incident routing decisions',
    paginated: true,
    description:
      'Requires both automation:read and incidents:read, and applies incident visibility filters. Exposes routing metadata only; stored source summaries are never returned.',
  },
  {
    method: 'get',
    path: '/services/{id}/automation/observations',
    summary: 'List safe field-discovery statistics',
    paginated: true,
    description:
      'Stable first-seen cursor ordering. Optional unmapped=true/false filter. Raw value previews and value hashes are never returned.',
  },

  {
    method: 'get',
    path: '/services/{id}/automation/versions',
    summary: 'List immutable service automation versions',
    paginated: true,
    description:
      'Bounded cursor pagination in descending version-number order. Cursors must belong to this service. Use the version detail resource for snapshots.',
  },
  {
    method: 'get',
    path: '/services/{id}/automation/versions/{versionId}',
    summary: 'Inspect an immutable automation version',
  },
  {
    method: 'get',
    path: '/services/{id}/automation',
    summary: 'Read effective service automation configuration',
    description:
      'Returns the configuration ETag for mode changes. Draft revision is a separate validator. Global OFF always produces effectiveMode DISABLED.',
  },
  {
    method: 'patch',
    path: '/services/{id}/automation/mode',
    summary: 'Change the service automation mode',
    description:
      'Send the ETag from GET /services/{id}/automation, not the draft ETag. Requires explicit publishing scope and administrator privilege. Global OFF prevents SHADOW/LIVE; LIVE validates its version-specific dependencies and shadow acknowledgments.',
    body: object(
      {
        mode: { type: 'string', enum: ['DISABLED', 'SHADOW', 'LIVE'] },
        expectedActiveVersionId: { type: ['string', 'null'] },
        acknowledgeNoShadow: { type: 'boolean' },
        acknowledgeShadowErrors: { type: 'boolean' },
      },
      ['mode', 'expectedActiveVersionId']
    ),
  },
  {
    method: 'post',
    path: '/services/{id}/automation/publish',
    summary: 'Publish a validated immutable service automation version',
    description:
      'Requires the draft resource ETag in If-Match. Returns immutable id, versionNumber and checksum without an ETag; read the draft again for the next mutation validator. Publishing while LIVE stages a candidate version evaluated in parallel shadow mode without interrupting current routing. Exact retries with the original required If-Match value return the committed result. Reusing an idempotency key with a different normalized revision returns 409; read current state and use a new key for a new conditional write.',
    body: object(
      {
        expectedActiveVersionId: { type: ['string', 'null'] },
        expectedCandidateVersionId: { type: ['string', 'null'] },
      },
      ['expectedActiveVersionId']
    ),
  },
  {
    method: 'get',
    path: '/services/{id}/automation/draft',
    summary: 'Read a service automation draft',
  },
  {
    method: 'put',
    path: '/services/{id}/automation/draft',
    summary: 'Save a revision-protected automation draft',
    body: automationDraftBody,
  },
  {
    method: 'get',
    path: '/services/{id}/automation/candidate',
    summary: 'Read a published candidate automation version and shadow metrics',
    description:
      'Reads the immutable candidate snapshot without its internal compiled representation, seven-day metrics, the reviewed qualification policy and bounded pending-observation state.',
  },
  {
    method: 'delete',
    path: '/services/{id}/automation/candidate',
    summary: 'Discard a published candidate automation version',
    description:
      'Discards a pending candidate version without promoting it to production. Requires expectedCandidateVersionId.',
    body: object({ expectedCandidateVersionId: id }, ['expectedCandidateVersionId']),
  },
  {
    method: 'post',
    path: '/services/{id}/automation/candidates/activate',
    summary: 'Atomically activate a candidate automation version as LIVE',
    description:
      'Atomically promotes the pending candidate after dependency and configured readiness checks. Pending observations above policy block activation. acknowledgeNoShadow explicitly accepts insufficient or stale daily evidence; acknowledgeShadowErrors accepts an excessive error rate. Supply expectedReadinessPolicyRevision from the candidate read to reject a stale policy review with 412. The canonical audit records current policy, evidence and exceptions.',
    body: object(
      {
        expectedCandidateVersionId: id,
        expectedActiveVersionId: { type: ['string', 'null'] },
        acknowledgeNoShadow: { type: 'boolean' },
        acknowledgeShadowErrors: { type: 'boolean' },
        acknowledgeMaterialDifferences: { type: 'boolean' },
        expectedReadinessPolicyRevision: integer,
      },
      ['expectedCandidateVersionId']
    ),
  },
  { method: 'get', path: '/settings/automation', summary: 'Read global automation settings' },
  {
    method: 'patch',
    path: '/settings/automation',
    summary: 'Update global automation settings',
    body: object(
      {
        automationEnabled: { type: 'boolean' },
        automationStoreObservationPreviews: { type: 'boolean' },
        automationReadinessPolicy: ref('AutomationReadinessPolicy'),
        automationTraceRetentionDays: { type: 'integer', minimum: 1, maximum: 3650 },
      },
      ['automationEnabled', 'automationTraceRetentionDays']
    ),
  },
  {
    method: 'get',
    path: '/incidents/{id}/watchers',
    summary: 'List incident watchers',
    paginated: true,
  },
  { method: 'get', path: '/incidents/{id}/tags', summary: 'List incident tags', paginated: true },
  { method: 'get', path: '/incidents/{id}/custom-fields', summary: 'List incident custom-field values', paginated: true },
  { method: 'get', path: '/incidents/templates', summary: 'List accessible incident templates', paginated: true },
  { method: 'post', path: '/incidents/templates', summary: 'Create an incident template', body: object({ name: string(120), title: string(200), description: { type: ['string', 'null'] }, descriptionText: { type: ['string', 'null'] }, defaultUrgency: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] }, defaultPriority: { type: ['string', 'null'] }, defaultServiceId: { type: ['string', 'null'] }, isPublic: { type: 'boolean' } }, ['name', 'title']) },
  { method: 'get', path: '/incidents/templates/{templateId}', summary: 'Read an accessible incident template' },
  { method: 'patch', path: '/incidents/templates/{templateId}', summary: 'Update an owned incident template', body: object({ name: string(120), title: string(200), description: { type: ['string', 'null'] }, descriptionText: { type: ['string', 'null'] }, defaultUrgency: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] }, defaultPriority: { type: ['string', 'null'] }, defaultServiceId: { type: ['string', 'null'] }, isPublic: { type: 'boolean' } }) },
  { method: 'delete', path: '/incidents/templates/{templateId}', summary: 'Delete an owned incident template' },
  { method: 'get', path: '/incidents/{id}/custom-fields/{fieldId}', summary: 'Read an incident custom-field value' },
  { method: 'put', path: '/incidents/{id}/custom-fields/{fieldId}', summary: 'Set an incident custom-field value', body: object({ value: { type: ['string', 'number', 'boolean', 'null'] } }, ['value']) },
  { method: 'post', path: '/incidents/{id}/tags', summary: 'Add a tag to an incident', body: object({ name: { ...string(100), minLength: 1 } }, ['name']) },
  { method: 'delete', path: '/incidents/{id}/tags/{tagId}', summary: 'Remove a tag from an incident' },
  { method: 'get', path: '/incidents/{id}/routing-decision', summary: 'Read the redacted routing decision for an accessible incident' },
  {
    method: 'post',
    path: '/incidents/{id}/watchers',
    summary: 'Add a watcher or change a watcher role',
    body: object(
      {
        userId: { ...id, maxLength: 100 },
        role: { type: 'string', enum: ['FOLLOWER', 'STAKEHOLDER', 'EXEC'], default: 'FOLLOWER' },
      },
      ['userId']
    ),
  },
  {
    method: 'delete',
    path: '/incidents/{id}/watchers/{watcherId}',
    summary: 'Remove a watcher from this incident',
  },
  {
    method: 'post',
    path: '/runbooks/{id}/executions/preview',
    summary: 'Preview an authorized execution without starting work',
    body: object({
      incidentId: { type: ['string', 'null'] },
      serviceId: { type: ['string', 'null'] },
      bindingId: { type: ['string', 'null'] },
      parameters: { type: 'object', additionalProperties: true },
    }),
  },
  {
    method: 'post',
    path: '/runbooks/executions/{id}/cancel',
    summary: 'Request cancellation; agent stop is asynchronous',
    status: 202,
    body: object({ reason: { ...string(1000), minLength: 1 } }, ['reason']),
  },
  {
    method: 'get',
    path: '/runbooks/executions',
    summary: 'List bounded Runbook executions for an accessible incident',
    description: 'Requires both runbooks:read and incidents:read. Returns execution metadata without inputs, plans, target details or agent output.',
    paginated: true,
  },
  {
    method: 'get',
    path: '/notifications/{id}/attempts',
    summary: 'List redacted delivery attempts for a notification',
    description: 'Provider message identifiers and raw error text are never returned.',
    paginated: true,
  },
  {
    method: 'get',
    path: '/notifications/{id}/feedback',
    summary: 'Read bounded provider feedback correlated with a notification',
    description: 'Returns at most 50 events correlated through up to 100 message identifiers. Identifiers and raw provider payloads are never disclosed; truncation flags describe the limits.',
  },
  {
    method: 'get',
    path: '/incidents/{id}/response-activity',
    summary: 'Read bounded incident response activity across alerting, routing, paging and remediation',
    description: 'Requires incidents:read, notifications:read and runbooks:read. Each section contains at most 50 newest records with a truncation flag; follow its dedicated paginated endpoint for older records. Raw alert payloads, notification content and Runbook inputs/output are excluded.',
  },
  {
    method: 'get', path: '/incidents/{id}/alerts',
    summary: 'List redacted alerts linked to an incident',
    description: 'Cursor-paginated. Correlation keys are returned only as keyed hashes; raw alert payloads are omitted.',
    paginated: true,
  },
  {
    method: 'get', path: '/incidents/{id}/runbook-executions',
    summary: 'List incident Runbook execution metadata',
    description: 'Requires incidents:read and runbooks:read. Inputs, plans, target details and agent output are omitted.',
    paginated: true,
  },
  {
    method: 'get', path: '/incidents/{id}/notification-attempts',
    summary: 'List incident notification delivery attempts',
    description: 'Requires incidents:read and notifications:read. Provider identifiers and raw errors are omitted.',
    paginated: true,
  },
  {
    method: 'get', path: '/incidents/{id}/available-actions',
    summary: 'Discover incident actions permitted for this credential and current state',
    description: 'Advisory snapshot only. Mutations recheck authorization and state. Runbook execution requires selecting a runbook and calling its preview before execution.',
  },
  {
    method: 'get', path: '/incidents/{id}/related-incidents',
    summary: 'Find accessible incidents linked by recorded alert correlation evidence',
    description: 'Scans at most 100 source alerts and 500 matching alerts, returning at most 50 unique incidents. Returns keyed correlation hashes and truncation flags; no raw deduplication keys or alert payloads.',
  },
  {
    method: 'get', path: '/operational-events',
    summary: 'List incident operational events visible to this credential',
    description: 'Cursor-paginated incident state events. Untrusted event messages and private incident details are omitted.',
    paginated: true,
  },
  {
    method: 'get', path: '/services/{id}/change-events',
    summary: 'List service configuration changes recorded in the canonical audit log',
    description: 'Requires services:read and audit:read. Returns action metadata only, without audit details or deployment telemetry.',
    paginated: true,
  },
  {
    method: 'post', path: '/escalation-policies/{id}/preview',
    summary: 'Preview escalation conditions and recipients without paging',
    description: 'Read-only advisory preview. Requires escalation-policies:read, incidents:read, users:read and schedules:read. Actual escalation rechecks state and may use pinned policy versions.',
    body: object({
      incidentId: id,
      at: { type: 'string', format: 'date-time' },
    }, ['incidentId']),
  },
  {
    method: 'get', path: '/services/{id}/health-summary',
    summary: 'Read bounded service health, visible incidents, paging failures and latest objectives',
    description: 'Requires services:read, incidents:read, notifications:read, service-objectives:read, escalation-policies:read and schedules:read. On-call coverage is based on the current first unconditional escalation step; conditional steps are explicitly marked unevaluated.',
  },
  {
    method: 'post',
    path: '/schedules/{id}/layers/{layerId}/participants',
    summary: 'Add an active rotation participant',
    status: 201,
    body: object({ userId: { ...id, maxLength: 100 } }, ['userId']),
  },
  {
    method: 'patch',
    path: '/schedules/{id}/layers/{layerId}/participants/{userId}',
    summary: 'Move a participant one position',
    body: object({ direction: { type: 'string', enum: ['up', 'down'] } }, ['direction']),
  },
  {
    method: 'delete',
    path: '/schedules/{id}/layers/{layerId}/participants/{userId}',
    summary: 'Remove a rotation participant',
  },
  ...['reopen', 'unacknowledge', 'snooze', 'unsnooze', 'suppress', 'unsuppress'].map(action => ({
    method: 'post' as const,
    path: `/incidents/{id}/${action}`,
    summary: `${action} an incident`,
    body:
      action === 'snooze'
        ? object(
            {
              ...(lifecycle.properties as Record<string, Schema>),
              snoozedUntil: date,
            },
            ['snoozedUntil']
          )
        : lifecycle,
  })),
  {
    method: 'post',
    path: '/runbooks',
    summary: 'Create a runbook with an initial draft',
    status: 201,
    body: object(
      {
        name: { ...string(200), minLength: 1 },
        slug: { ...string(120), minLength: 1, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' },
        description: string(5000),
        ...(draftInput.properties as Record<string, Schema>),
      },
      ['name', 'slug']
    ),
  },
  {
    method: 'get',
    path: '/runbooks/{id}/versions',
    summary: 'List redacted version summaries',
    paginated: true,
  },
  {
    method: 'post',
    path: '/runbooks/{id}/drafts',
    summary: 'Clone a version to a draft',
    status: 201,
    body: object({ sourceVersionId: id }, ['sourceVersionId']),
  },
  {
    method: 'get',
    path: '/runbooks/{id}/drafts/{versionId}',
    summary: 'Read an editable draft with hidden configuration and its revision',
  },
  {
    method: 'patch',
    path: '/runbooks/{id}/drafts/{versionId}',
    summary: 'Replace a draft definition with revision protection',
    body: {
      ...draftInput,
      properties: {
        ...(draftInput.properties as Record<string, Schema>),
        preserveConfiguration: { type: 'boolean', default: false },
      },
    },
  },
  {
    method: 'post',
    path: '/runbooks/{id}/drafts/{versionId}/validate',
    summary: 'Validate a saved draft without executing it',
    body: object({}),
  },
  {
    method: 'post',
    path: '/runbooks/{id}/drafts/{versionId}/publish',
    summary: 'Publish the validated saved draft',
    body: object({}),
  },
  { method: 'get', path: '/reports/saved', summary: 'List owned and accessible saved reports', paginated: true },
  { method: 'post', path: '/reports/saved', summary: 'Save a bounded report definition', status: 201,
    body: object({ name: string(200), description: string(2000), metrics: array(string(), 16),
      windowDays: { type: 'integer', minimum: 1, maximum: 90 }, serviceId: id,
      visibility: string(), teamId: id }, ['name', 'metrics']) },
  { method: 'get', path: '/reports/saved/{id}', summary: 'Read an accessible report definition' },
  { method: 'patch', path: '/reports/saved/{id}', summary: 'Update an owned report with an exact revision precondition',
    body: object({ name: string(200), description: string(2000), metrics: array(string(), 16),
      windowDays: { type: 'integer', minimum: 1, maximum: 90 }, serviceId: id,
      visibility: string(), teamId: id }) },
  { method: 'delete', path: '/reports/saved/{id}', summary: 'Delete an owned saved report with an exact revision precondition', status: 204 },
  { method: 'get', path: '/reports/catalog', summary: 'List supported report metrics and dimensions' },
  { method: 'post', path: '/reports/query', summary: 'Run a bounded actor-scoped analytical query',
    body: object({ metrics: array(string(), 16), windowDays: { type: 'integer', minimum: 1, maximum: 90 }, serviceId: id }, ['metrics']) },
  {
    method: 'get', path: '/dashboards',
    summary: 'List accessible saved dashboards and templates', paginated: true,
  },
  {
    method: 'post', path: '/dashboards',
    summary: 'Create a saved dashboard', status: 201,
    body: object({ name: string(200), description: string(2000), visibility: string(),
      teamId: id, templateId: id, sourceTemplate: string(100),
      widgets: array(ref('ReportDashboardWidget'), 50) }, ['name']),
  },
  { method: 'get', path: '/dashboards/{id}', summary: 'Read an accessible saved dashboard' },
  { method: 'get', path: '/dashboards/{id}/data', summary: 'Calculate actor-scoped data for an accessible dashboard' },
  { method: 'get', path: '/dashboards/{id}/export', summary: 'Download a bounded JSON snapshot of accessible dashboard data',
    description: 'Requires reports:read and incidents:read. Uses the same actor-scoped calculation and optional days/serviceId filters as the data endpoint. Maximum 256 KiB; private no-store response with SHA-256 checksum and attributed download audit.' },
  { method: 'post', path: '/dashboards/{id}/duplicate', summary: 'Duplicate an accessible dashboard into an owned dashboard', status: 201,
    body: object({ name: string(200), visibility: string(), teamId: id }) },
  { method: 'get', path: '/dashboards/{id}/widgets', summary: 'List widgets of an accessible dashboard' },
  { method: 'put', path: '/dashboards/{id}/widgets', summary: 'Replace owned dashboard widgets with an exact revision precondition',
    body: object({ widgets: array(ref('ReportDashboardWidget'), 50) }, ['widgets']) },
  {
    method: 'patch', path: '/dashboards/{id}',
    summary: 'Update an owned dashboard with a strong revision precondition',
    body: object({ name: string(200), description: string(2000), visibility: string(),
      teamId: id, layout: { type: 'object' }, config: { type: 'object' },
      widgets: array(ref('ReportDashboardWidget'), 50) }),
  },
  { method: 'delete', path: '/dashboards/{id}', summary: 'Delete an owned dashboard with a strong revision precondition', status: 204 },
  { method: 'post', path: '/reports/exports', summary: 'Queue a bounded, encrypted report export', status: 201,
    body: object({ metrics: array(string(), 16), windowDays: { type: 'integer', minimum: 1, maximum: 90 }, serviceId: id }, ['metrics']) },
  { method: 'get', path: '/reports/exports/{id}', summary: 'Read owned report export job state and integrity metadata' },
  { method: 'get', path: '/reports/exports/{id}/download', summary: 'Download an authorized report export',
    description: 'Returns an application/json file, not a JSON response envelope. Requires current global report and incident permissions.' },
  { method: 'post', path: '/reports/exports/{id}/cancel', summary: 'Cancel a pending owned report export' },
];

/** Add only implemented operations; the canonical registry finalizes shared contracts. */
export function enterpriseOpenApiPaths() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const operation of operations) {
    const parameters = [...operation.path.matchAll(/\{(\w+)\}/g)].map(match => ({
      name: match[1],
      in: 'path',
      required: true,
      schema: id,
    }));
    const queryParameters = operation.paginated
      ? [
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          },
          { name: 'cursor', in: 'query', required: false, schema: string() },
        ]
      : [];
    const pathItem = (paths[operation.path] ??= {});
    pathItem[operation.method] = {
      tags: [
        operation.path.startsWith('/service-objectives')
          ? 'Service Objectives'
          : operation.path.startsWith('/reports') || operation.path.startsWith('/dashboards')
            ? 'Reports'
          : operation.path.startsWith('/status-pages')
            ? 'Status Pages'
            : operation.path.startsWith('/settings')
              ? 'Settings'
              : operation.path.startsWith('/runbooks')
                ? 'Runbooks'
                : operation.path.startsWith('/services')
                  ? 'Services'
                  : operation.path.startsWith('/schedules')
                    ? 'Schedules'
                    : operation.path.startsWith('/teams')
                      ? 'Teams'
                      : 'Incidents',
      ],
      summary: operation.summary,
      ...(operation.description ? { description: operation.description } : {}),
      parameters: [
        ...parameters,
        ...queryParameters,
        ...(operation.path === '/runbooks/executions'
          ? [{ name: 'incidentId', in: 'query', required: true, schema: { ...id, maxLength: 100 } }]
          : []),
        ...(['/dashboards/{id}/data', '/dashboards/{id}/export'].includes(operation.path)
          ? [
              { name: 'days', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 90 } },
              { name: 'serviceId', in: 'query', required: false, schema: id },
            ]
          : []),
        ...(operation.method === 'get' && operation.path === '/service-objectives'
          ? [{ name: 'serviceId', in: 'query', required: false, schema: id }]
          : []),
        ...(operation.path === '/service-objectives/{id}/history'
          ? [
              {
                name: 'source',
                in: 'query',
                required: false,
                schema: {
                  type: 'string',
                  enum: ['OBJECTIVE', 'LEGACY_INCIDENT_SLA'],
                  default: 'OBJECTIVE',
                },
              },
            ]
          : []),
        ...(operation.path === '/runbooks/{id}/versions/{versionId}/diff'
          ? [{ name: 'baseVersionId', in: 'query', required: true, schema: id }]
          : []),
        ...(operation.path.endsWith('/automation/observations')
          ? [
              {
                name: 'unmapped',
                in: 'query',
                required: false,
                schema: { type: 'string', enum: ['true', 'false'] },
              },
            ]
          : []),
      ],
      ...(operation.path.endsWith('/automation/decisions')
        ? { 'x-additional-required-scopes': ['incidents:read'] }
        : operation.path === '/dashboards/{id}/data' || operation.path === '/dashboards/{id}/export' || operation.path === '/reports/query' || operation.path.startsWith('/reports/exports')
          ? { 'x-additional-required-scopes': ['incidents:read'] }
        : {}),
      ...(operation.body
        ? {
            requestBody: {
              required: true,
              content: { 'application/json': { schema: operation.body } },
            },
          }
        : {}),
      responses: {
        [String(operation.status ?? 200)]: { description: 'Operation completed' },
        '400': { $ref: '#/components/responses/ProblemError' },
        '403': { $ref: '#/components/responses/ProblemError' },
        '404': { $ref: '#/components/responses/ProblemError' },
        '413': { $ref: '#/components/responses/ProblemError' },
        ...(operation.method === 'post' && operation.path === '/service-objectives'
          ? { '412': { $ref: '#/components/responses/PreconditionFailed' } }
          : {}),
        ...(operation.method === 'get' && operation.path === '/services/{id}/runbook-rules/{ruleId}'
          ? { '409': { $ref: '#/components/responses/ProblemError' } }
          : {}),
      },
    };
  }
  return paths;
}
