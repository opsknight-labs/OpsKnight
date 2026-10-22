import { z } from 'zod';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { EnrollmentBody } from '@/lib/api-v2/runbook-fleet';
import { createAgentEnrollment } from '@/lib/runbooks/agent-auth';
export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_AGENT_ENROLL,
  querySchema: z.object({}).strict(),
  bodySchema: EnrollmentBody,
  idempotent: true,
  idempotencyRequired: true,
  persistIdempotencyResult: result => {
    if (result instanceof Response)
      throw new Error('Enrollment replay requires a safe metadata projection.');
    return { ...result, data: { ...result.data, token: null } };
  },
  handler: async ({ tx, actor, apiKey, body }) => {
    const result = await createAgentEnrollment({ ...body, actorId: actor.id }, tx, apiKey.id);
    return {
      status: 201,
      data: {
        id: result.agent.id,
        status: result.agent.status,
        token: result.token as string | null,
        executionPublicKey: result.executionPublicKey,
        expiresAt: result.enrollmentExpiresAt,
      },
      headers: {
        'Cache-Control': 'no-store',
        Location: `/api/v2/runbooks/agent-enrollments/${result.agent.id}`,
      },
    };
  },
});
