type Schema = Record<string, unknown>;
const text: Schema = { type: 'string' };
const nullableText: Schema = { type: ['string', 'null'] };
const date: Schema = { type: 'string', format: 'date-time' };
const nullableDate: Schema = { type: ['string', 'null'], format: 'date-time' };
const integer: Schema = { type: 'integer', minimum: 0 };
const object = (
  properties: Record<string, Schema>,
  required = Object.keys(properties)
): Schema => ({ type: 'object', properties, required, additionalProperties: false });
const digest: Schema = { type: 'string', pattern: '^[a-f0-9]{64}$' };
export const RUNBOOK_INTERVENTION_SCHEMAS: Record<string, Schema> = {
  RunbookIntervention: object({
    executionId: text,
    stepId: text,
    status: { type: 'string', enum: ['APPROVED', 'CANCEL_REQUESTED'] },
  }),
  RunbookRerun: object({ executionId: text, sourceExecutionId: text, status: text }),
  RunbookExecutionStepSummary: object({
    id: text,
    stepKey: text,
    sequence: integer,
    name: text,
    type: text,
    riskClass: text,
    status: text,
    requiresApproval: { type: 'boolean' },
    approvedAt: nullableDate,
    attemptCount: integer,
    startedAt: nullableDate,
    completedAt: nullableDate,
    createdAt: date,
    pendingApproval: {
      oneOf: [
        { type: 'null' },
        object({
          planDigest: digest,
          timeoutSeconds: integer,
          plan: {
            type: 'array',
            maxItems: 10,
            items: { type: 'array', minItems: 2, maxItems: 2, items: text },
          },
        }),
      ],
    },
  }),
  RunbookExecutionEvidence: object({
    id: text,
    executionStepId: text,
    attemptNumber: integer,
    status: text,
    planDigest: nullableText,
    createdAt: date,
    completedAt: nullableDate,
    evidence: { type: 'string', maxLength: 16000 },
  }),
  RunbookExecutionEvent: object({ id: text, action: text, actorId: nullableText, createdAt: date }),
};
const base = '/runbooks/executions/{id}';
export const RUNBOOK_INTERVENTION_OPERATIONS: {
  method: 'get' | 'post';
  path: string;
  summary: string;
  description?: string;
  body?: Schema;
  status?: number;
  paginated?: boolean;
}[] = [
  {
    method: 'get',
    path: `${base}/steps`,
    summary: 'Read bounded execution steps and eligible pending approval plans',
    paginated: true,
    description:
      'Requires runbooks:read. Pending approval plans additionally require explicit runbooks:approve and approver capability plus execution ownership/service-team access (ADMIN excepted). Configuration, raw inputs and secret values are never returned.',
  },
  {
    method: 'get',
    path: `${base}/evidence`,
    summary: 'Read redacted bounded execution attempt evidence',
    paginated: true,
  },
  {
    method: 'get',
    path: `${base}/events`,
    summary: 'Read bounded execution business-event metadata',
    paginated: true,
  },
  {
    method: 'post',
    path: `${base}/steps/{stepId}/approve`,
    summary: 'Approve the exact reviewed waiting step',
    status: 202,
    body: object({ planDigest: digest }),
    description:
      'Explicit runbooks:approve plus runbooks:read. Caller must own the execution or belong to its service team, unless ADMIN. Required retry key binds the exact reviewed plan. Domain command verifies the waiting state and digest; approval, job, canonical audit and replay commit together. Replays reauthorize execution access.',
  },
  {
    method: 'post',
    path: `${base}/steps/{stepId}/reject`,
    summary: 'Reject the exact reviewed waiting step and request cancellation',
    status: 202,
    body: object({ planDigest: digest, reason: { type: 'string', minLength: 1, maxLength: 1000 } }),
    description:
      'Same scope and ownership policy as approval. Rejection cancels the waiting step and requests parent cancellation atomically. Poll parent status for final reconciliation.',
  },
  {
    method: 'post',
    path: `${base}/rerun-preview`,
    summary: 'Preview a finished execution against current rules and published version',
    body: object({}),
    description:
      'Requires runbooks:execute and runbooks:read, execution ownership/team access and current target/rule policy. Does not start execution. The preview supplies the plan digest and authorization token for rerun.',
  },
  {
    method: 'post',
    path: `${base}/rerun`,
    summary: 'Start a reviewed rerun of a finished execution',
    status: 202,
    body: object({ expectedPlanDigest: digest, previewAuthorizationToken: digest }),
    description:
      'Required retry key. Current source, rule, inputs, role and target policy are revalidated. Changed plans fail. New execution, canonical audit, durable advance job and replay commit together. Cached results require current source access.',
  },
];
