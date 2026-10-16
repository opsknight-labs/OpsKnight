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
const note = { ...string(1000) };
const lifecycle = object({
  note,
  expectedStatus: {
    type: 'string',
    enum: ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'SNOOZED', 'SUPPRESSED'],
  },
});

export const ENTERPRISE_SCHEMAS: Record<string, Schema> = {
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
    },
    ['key', 'label']
  ),
  RunbookAuthoringVersion: object(
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
  method: 'get' | 'post' | 'patch' | 'delete';
  path: string;
  summary: string;
  body?: Schema;
  status?: number;
  paginated?: boolean;
}
const operations: Operation[] = [
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
    summary: 'Read a redacted version and its draft revision',
  },
  {
    method: 'patch',
    path: '/runbooks/{id}/drafts/{versionId}',
    summary: 'Replace a draft definition with revision protection',
    body: draftInput,
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
        operation.path.startsWith('/runbooks')
          ? 'Runbooks'
          : operation.path.startsWith('/schedules')
            ? 'Schedules'
            : 'Incidents',
      ],
      summary: operation.summary,
      parameters: [...parameters, ...queryParameters],
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
