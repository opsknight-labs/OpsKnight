import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { RuleParams, reviewRuleReadiness } from '@/lib/api-v2/runbook-rules';
export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_RULE_READ,
  paramsSchema: RuleParams,
  querySchema: z.object({}).strict(),
  bodySchema: z.object({}).strict(),
  handler: async ({ params }) => ({
    data: await reviewRuleReadiness(prisma, params.id, params.ruleId),
    headers: { 'Cache-Control': 'no-store' },
  }),
});
