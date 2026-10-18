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

export const ENTERPRISE_SCHEMAS: Record<string, Schema> = {
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
      'Reads the pending candidate version, compiled configuration and seven-day shadow evaluation metrics for a service in LIVE mode.',
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
      'Promotes the pending candidate version to active production routing with zero interruption. Validates shadow evidence and escalation policy safety before cutover.',
    body: object(
      {
        expectedCandidateVersionId: id,
        expectedActiveVersionId: { type: ['string', 'null'] },
        acknowledgeNoShadow: { type: 'boolean' },
        acknowledgeShadowErrors: { type: 'boolean' },
        acknowledgeMaterialDifferences: { type: 'boolean' },
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
        operation.path.startsWith('/settings')
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
      },
    };
  }
  return paths;
}
