import { statusPageSectionFields } from '@/lib/status-pages/settings-sections';
import { AUTOMATION_SCHEMAS, automationDraftBody } from './automation-openapi';
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
  RunbookCancellationRequested: object(
    { executionId: id, status: { const: 'CANCEL_REQUESTED' }, message: string() },
    ['executionId', 'status', 'message']
  ),
  RunbookExecutionPreview: object(
    {
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
      'Returns a persisted job and Location. Matching retry keys do not enqueue again. Inspect job result and current publication; a completed job can report FAILED publication. Queue retries preserve a single canonical audit receipt.',
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
      'Requires the draft resource ETag in If-Match. Returns immutable id, versionNumber and checksum without an ETag; read the draft again for the next mutation validator. Publishing while LIVE stages a candidate version evaluated in parallel shadow mode without interrupting current routing. Replayed requests return the original committed result, even with a different concrete If-Match value; use a new idempotency key for a new conditional write.',
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
        operation.path.startsWith('/status-pages')
          ? 'Status Pages'
          : operation.path.startsWith('/settings')
            ? 'Settings'
            : operation.path.startsWith('/runbooks')
              ? 'Runbooks'
              : operation.path.startsWith('/services')
                ? 'Services'
                : operation.path.startsWith('/schedules')
                  ? 'Schedules'
                  : 'Incidents',
      ],
      summary: operation.summary,
      ...(operation.description ? { description: operation.description } : {}),
      parameters: [
        ...parameters,
        ...queryParameters,
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
        ...(operation.method === 'get' && operation.path === '/services/{id}/runbook-rules/{ruleId}'
          ? { '409': { $ref: '#/components/responses/ProblemError' } }
          : {}),
      },
    };
  }
  return paths;
}
