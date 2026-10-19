import type { RUNBOOK_INTERVENTION_OPERATIONS } from './runbook-intervention-openapi';
type Schema = Record<string, unknown>;
const text: Schema = { type: 'string' };
const nullableText: Schema = { type: ['string', 'null'] };
const date: Schema = { type: 'string', format: 'date-time' };
const nullableDate: Schema = { type: ['string', 'null'], format: 'date-time' };
const count: Schema = { type: 'integer', minimum: 0 };
const bool: Schema = { type: 'boolean' };
const object = (
  properties: Record<string, Schema>,
  required = Object.keys(properties)
): Schema => ({ type: 'object', additionalProperties: false, properties, required });
export const RUNBOOK_FLEET_SCHEMAS: Record<string, Schema> = {
  RunbookAgent: object({
    id: text,
    name: text,
    hostname: nullableText,
    status: text,
    version: nullableText,
    platform: nullableText,
    capabilities: { type: 'array', items: text },
    policyHash: nullableText,
    lastHeartbeatAt: nullableDate,
    spoolDepth: count,
    deadLetterDepth: count,
    activeAttemptCount: count,
    hasDiagnosticError: bool,
    enrolledAt: nullableDate,
    revokedAt: nullableDate,
    createdAt: date,
    updatedAt: date,
  }),
  RunbookAgentPolicyStatus: object({
    agentId: text,
    status: text,
    capabilities: { type: 'array', items: text },
    policyHash: nullableText,
    lastHeartbeatAt: nullableDate,
    hasDiagnosticError: bool,
  }),
  RunbookAgentRevocation: object({
    id: text,
    status: { type: 'string', enum: ['REVOKED'] },
    revokedAt: nullableDate,
  }),
  RunbookAgentEnrollment: object({
    id: text,
    status: text,
    token: nullableText,
    executionPublicKey: text,
    expiresAt: date,
  }),
  RunbookAgentEnrollmentStatus: object({
    id: text,
    status: text,
    enrollmentState: {
      type: 'string',
      enum: ['PENDING', 'EXPIRED', 'CONSUMED', 'REVOKED', 'UNKNOWN'],
    },
    expiresAt: nullableDate,
    enrolledAt: nullableDate,
    revokedAt: nullableDate,
  }),
};
export const RUNBOOK_FLEET_OPERATIONS: typeof RUNBOOK_INTERVENTION_OPERATIONS = [
  {
    method: 'get',
    path: '/runbooks/agents',
    summary: 'List privileged Agent fleet health',
    paginated: true,
    description:
      'Explicit runbook-agents:read and administrator capability. Bounded cursor pagination. Signing material, token hashes, raw diagnostic errors and raw capability reports are excluded.',
  },
  { method: 'get', path: '/runbooks/agents/{id}', summary: 'Read safe Agent fleet details' },
  {
    method: 'get',
    path: '/runbooks/agents/{id}/policy-status',
    summary: 'Read reported Agent policy and capability status',
    description:
      'Reported health only; does not assert a target is eligible for any arbitrary action. Execution preview still evaluates target-specific policy.',
  },
  {
    method: 'post',
    path: '/runbooks/agent-enrollments',
    summary: 'Issue one-time Agent enrollment',
    status: 201,
    body: object(
      {
        name: { type: 'string', minLength: 1, maxLength: 200 },
        hostname: { type: 'string', minLength: 1, maxLength: 255 },
      },
      ['name']
    ),
    description:
      'Explicit runbook-agents:enroll and administrator capability. Required Idempotency-Key. Only the first committed response contains the one-time token; retries return the same enrollment metadata with token null. The token is never persisted in the replay journal. GET enrollment status never discloses it. If the first response is lost, revoke the enrollment and create a new one with a new key. Mutation, canonical credential-attributed audit and safe replay metadata commit together. Agent enrollment is consumed separately by the signed Agent protocol.',
  },
  {
    method: 'get',
    path: '/runbooks/agent-enrollments/{id}',
    summary: 'Read enrollment status without token disclosure',
  },
  {
    method: 'post',
    path: '/runbooks/agents/{id}/revoke',
    summary: 'Revoke an Agent identity',
    body: object({}),
    description:
      'Explicit runbook-agents:revoke and administrator capability. Terminal conditional transition clears enrollment, prevents future authenticated claims and leaves existing lease reconciliation authoritative. Different retry keys do not duplicate revocation audit events.',
  },
];
