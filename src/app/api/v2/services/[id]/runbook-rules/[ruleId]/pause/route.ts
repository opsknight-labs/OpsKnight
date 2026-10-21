import { z } from 'zod';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { pauseServiceRule } from '@/lib/runbooks/bindings';
import { RuleParams, requireRule, ruleResult } from '@/lib/api-v2/runbook-rules';
export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_RULE_MANAGE,
  paramsSchema: RuleParams,
  querySchema: z.object({}).strict(),
  bodySchema: z.object({}).strict(),
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  handler: async ({ params, req, actor, apiKey, tx }) => {
    await requireRule(tx!, params.id, params.ruleId, req);
    await pauseServiceRule(params.id, params.ruleId, { id: actor.id, apiKeyId: apiKey.id }, tx);
    return ruleResult(await requireRule(tx!, params.id, params.ruleId));
  },
});
