import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { RunbookParams } from '@/lib/api-v2/runbook-authoring';
import { checkRunbookDeleteEligibility } from '@/lib/runbooks/lifecycle';
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_MANAGE,
  paramsSchema: RunbookParams,
  querySchema: z.object({}).strict(),
  handler: async ({ params }) => ({ data: await checkRunbookDeleteEligibility(params.id) }),
});
