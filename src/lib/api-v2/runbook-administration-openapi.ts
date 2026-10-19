type Schema = Record<string, unknown>;
const text: Schema = { type: 'string' };
const nullableText: Schema = { type: ['string', 'null'] };
const date: Schema = { type: 'string', format: 'date-time' };
const integer: Schema = { type: 'integer', minimum: 0 };
const labels: Schema = {
  type: 'object',
  additionalProperties: { type: 'string', maxLength: 200 },
  propertyNames: { pattern: '^[a-zA-Z0-9_.-]{1,64}$' },
  maxProperties: 32,
};
const object = (
  properties: Record<string, Schema>,
  required = Object.keys(properties)
): Schema => ({ type: 'object', additionalProperties: false, properties, required });
const name: Schema = { type: 'string', minLength: 1, maxLength: 200 };
const description: Schema = { type: 'string', maxLength: 1000 };
const mode: Schema = { type: 'string', enum: ['LOCAL_HOSTS', 'SHARED_TARGET'] };
const secretValue: Schema = { type: 'string', minLength: 1, maxLength: 65536, writeOnly: true };
const poolCreate = object({ name, description, mode, matchLabels: labels }, ['name']);
const poolPatch = {
  ...object({ name, description, mode, matchLabels: labels }, []),
  minProperties: 1,
};
const agentPatch = { ...object({ name, labels }, []), minProperties: 1 };
const secretCreate = object(
  { name: { ...name, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' }, value: secretValue, description },
  ['name', 'value']
);
const grantInput = { oneOf: [object({ agentId: text }), object({ agentPoolId: text })] };
const budget: Schema = { type: 'integer', minimum: 0, maximum: 100 };
const settingsFields = {
  runbookArtifactRetentionDays: { type: ['integer', 'null'], minimum: 1, maximum: 3650 },
  runbookAutoExecutionsPerIncident: budget,
  runbookAutoWritesPerIncident: budget,
  runbookAutoNonIdempotentPerIncident: budget,
};
const settingsPatch = {
  ...object(
    {
      ...settingsFields,
      runbookArtifactRetentionDays: { type: 'integer', minimum: 1, maximum: 3650 },
      confirmArtifactCleanup: { const: true },
    },
    []
  ),
  minProperties: 1,
  dependentRequired: { runbookArtifactRetentionDays: ['confirmArtifactCleanup'] },
};
export const RUNBOOK_ADMINISTRATION_SCHEMAS: Record<string, Schema> = {
  RunbookAgentPool: object({
    id: text,
    name: text,
    description,
    mode,
    matchLabels: labels,
    revision: integer,
    createdAt: date,
    updatedAt: date,
  }),
  RunbookAgentPoolMember: object({
    id: text,
    poolId: text,
    agentId: text,
    source: { type: 'string', enum: ['EXPLICIT', 'DYNAMIC'] },
    createdAt: date,
    agent: object({ id: text, name: text, status: text }),
  }),
  RunbookAgentPoolMembership: object({
    poolId: text,
    agentId: text,
    revision: integer,
    membership: { oneOf: [{ type: 'null' }, object({ id: text, source: text })] },
  }),
  RunbookAgentConfiguration: object({ id: text, name: text, labels, revision: integer }),
  RunbookAgentPoolDeletionCheck: object({
    poolId: text,
    revision: integer,
    canDelete: { type: 'boolean' },
    dependencies: object({
      serviceRules: integer,
      executions: integer,
      attempts: integer,
      secretGrants: integer,
    }),
  }),
  RunbookSecretMetadata: object({
    id: text,
    name: text,
    reference: text,
    description,
    revision: integer,
    lastRotatedAt: { type: ['string', 'null'], format: 'date-time' },
    createdAt: date,
    updatedAt: date,
  }),
  RunbookSecretGrant: object({
    id: text,
    secretId: text,
    agentId: nullableText,
    agentPoolId: nullableText,
    createdAt: date,
  }),
  RunbookSettings: object({ ...settingsFields, runbookSettingsRevision: integer }),
};
export const RUNBOOK_ADMINISTRATION_OPERATIONS: {
  method: 'get' | 'post' | 'patch' | 'put' | 'delete';
  path: string;
  summary: string;
  description?: string;
  body?: Schema;
  status?: number;
  paginated?: boolean;
}[] = [
  {
    method: 'get',
    path: '/runbooks/agent-pools',
    description:
      'Dedicated administrator scope required. Secret values are write-only. Secret-bearing pool expansion also requires runbook-secrets:grant. Already accepted claims cannot be recalled by grant revocation.',
    summary: 'listRunbookAgentPools',
    paginated: true,
  },
  {
    method: 'post',
    path: '/runbooks/agent-pools',
    description:
      'Dedicated administrator scope required. Secret values are write-only. Secret-bearing pool expansion also requires runbook-secrets:grant. Already accepted claims cannot be recalled by grant revocation.',
    summary: 'createRunbookAgentPool',
    status: 201,
    body: poolCreate,
  },
  {
    method: 'get',
    path: '/runbooks/agent-pools/{id}',
    description:
      'Dedicated administrator scope required. Secret values are write-only. Secret-bearing pool expansion also requires runbook-secrets:grant. Already accepted claims cannot be recalled by grant revocation.',
    summary: 'getRunbookAgentPool',
  },
  {
    method: 'patch',
    path: '/runbooks/agent-pools/{id}',
    description:
      'Dedicated administrator scope required. Secret values are write-only. Secret-bearing pool expansion also requires runbook-secrets:grant. Already accepted claims cannot be recalled by grant revocation.',
    summary: 'updateRunbookAgentPool',
    body: poolPatch,
  },
  {
    method: 'delete',
    path: '/runbooks/agent-pools/{id}',
    description:
      'Dedicated administrator scope required. Secret values are write-only. Secret-bearing pool expansion also requires runbook-secrets:grant. Already accepted claims cannot be recalled by grant revocation.',
    summary: 'deleteRunbookAgentPool',
    status: 204,
  },
  {
    method: 'get',
    path: '/runbooks/agent-pools/{id}/deletion-check',
    description:
      'Dedicated administrator scope required. Secret values are write-only. Secret-bearing pool expansion also requires runbook-secrets:grant. Already accepted claims cannot be recalled by grant revocation.',
    summary: 'checkRunbookAgentPoolDeletion',
  },
  {
    method: 'get',
    path: '/runbooks/agent-pools/{id}/members',
    description:
      'Dedicated administrator scope required. Secret values are write-only. Secret-bearing pool expansion also requires runbook-secrets:grant. Already accepted claims cannot be recalled by grant revocation.',
    summary: 'listRunbookAgentPoolMembers',
    paginated: true,
  },
  {
    method: 'put',
    path: '/runbooks/agent-pools/{id}/members/{agentId}',
    description:
      'Dedicated administrator scope required. Secret values are write-only. Secret-bearing pool expansion also requires runbook-secrets:grant. Already accepted claims cannot be recalled by grant revocation.',
    summary: 'setRunbookAgentPoolMember',
    body: object({}),
  },
  {
    method: 'delete',
    path: '/runbooks/agent-pools/{id}/members/{agentId}',
    description:
      'Dedicated administrator scope required. Secret values are write-only. Secret-bearing pool expansion also requires runbook-secrets:grant. Already accepted claims cannot be recalled by grant revocation.',
    summary: 'removeRunbookAgentPoolMember',
  },
  {
    method: 'get',
    path: '/runbooks/agents/{id}/configuration',
    description:
      'Dedicated administrator scope required. Secret values are write-only. Secret-bearing pool expansion also requires runbook-secrets:grant. Already accepted claims cannot be recalled by grant revocation.',
    summary: 'getRunbookAgentConfiguration',
  },
  {
    method: 'patch',
    path: '/runbooks/agents/{id}/configuration',
    description:
      'Dedicated administrator scope required. Secret values are write-only. Secret-bearing pool expansion also requires runbook-secrets:grant. Already accepted claims cannot be recalled by grant revocation.',
    summary: 'updateRunbookAgentConfiguration',
    body: agentPatch,
  },
  {
    method: 'get',
    path: '/runbooks/secrets',
    description:
      'Dedicated administrator scope required. Secret values are write-only. Secret-bearing pool expansion also requires runbook-secrets:grant. Already accepted claims cannot be recalled by grant revocation.',
    summary: 'listRunbookSecrets',
    paginated: true,
  },
  {
    method: 'post',
    path: '/runbooks/secrets',
    description:
      'Dedicated administrator scope required. Secret values are write-only. Secret-bearing pool expansion also requires runbook-secrets:grant. Already accepted claims cannot be recalled by grant revocation.',
    summary: 'createRunbookSecret',
    status: 201,
    body: secretCreate,
  },
  {
    method: 'get',
    path: '/runbooks/secrets/{id}',
    description:
      'Dedicated administrator scope required. Secret values are write-only. Secret-bearing pool expansion also requires runbook-secrets:grant. Already accepted claims cannot be recalled by grant revocation.',
    summary: 'getRunbookSecret',
  },
  {
    method: 'post',
    path: '/runbooks/secrets/{id}/rotate',
    description:
      'Dedicated administrator scope required. Secret values are write-only. Secret-bearing pool expansion also requires runbook-secrets:grant. Already accepted claims cannot be recalled by grant revocation.',
    summary: 'rotateRunbookSecret',
    body: object({ value: secretValue }),
  },
  {
    method: 'get',
    path: '/runbooks/secrets/{id}/grants',
    description:
      'Dedicated administrator scope required. Secret values are write-only. Secret-bearing pool expansion also requires runbook-secrets:grant. Already accepted claims cannot be recalled by grant revocation.',
    summary: 'listRunbookSecretGrants',
    paginated: true,
  },
  {
    method: 'post',
    path: '/runbooks/secrets/{id}/grants',
    description:
      'Dedicated administrator scope required. Secret values are write-only. Secret-bearing pool expansion also requires runbook-secrets:grant. Already accepted claims cannot be recalled by grant revocation.',
    summary: 'grantRunbookSecret',
    body: grantInput,
  },
  {
    method: 'delete',
    path: '/runbooks/secrets/{id}/grants/{grantId}',
    description:
      'Dedicated administrator scope required. Secret values are write-only. Secret-bearing pool expansion also requires runbook-secrets:grant. Already accepted claims cannot be recalled by grant revocation.',
    summary: 'revokeRunbookSecretGrant',
    status: 204,
  },
  {
    method: 'get',
    path: '/settings/runbooks',
    description:
      'Dedicated administrator scope required. Secret values are write-only. Secret-bearing pool expansion also requires runbook-secrets:grant. Already accepted claims cannot be recalled by grant revocation.',
    summary: 'getRunbookSettings',
  },
  {
    method: 'patch',
    path: '/settings/runbooks',
    description:
      'Dedicated administrator scope required. Secret values are write-only. Secret-bearing pool expansion also requires runbook-secrets:grant. Already accepted claims cannot be recalled by grant revocation.',
    summary: 'updateRunbookSettings',
    body: settingsPatch,
  },
];
