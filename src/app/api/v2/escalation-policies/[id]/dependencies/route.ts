import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { inspectEscalationPolicy } from '@/lib/escalation/policy-inspection';

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.ESCALATION_POLICY_READ,
  paramsSchema: z.object({ id: z.string().trim().min(1).max(100) }).strict(),
  querySchema: z.object({}).strict(),
  handler: async ({ params }) => {
    const {
      issues: _issues,
      revision: _revision,
      ...data
    } = await inspectEscalationPolicy(params.id);
    return { data, headers: { 'Cache-Control': 'no-store' } };
  },
});
