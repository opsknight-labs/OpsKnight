import { z } from 'zod';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { RuleParams, RuleTriggerBody, requireRule, ruleResult } from '@/lib/api-v2/runbook-rules';
import { replaceBindingTrigger } from '@/lib/runbooks/bindings';
export const PUT = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_RULE_MANAGE,
  paramsSchema: RuleParams,
  querySchema: z.object({}).strict(),
  bodySchema: RuleTriggerBody,
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  handler: async ({ params, req, body, actor, apiKey, tx }) => {
    const current = await requireRule(tx!, params.id, params.ruleId, req);
    await replaceBindingTrigger(
      params.id,
      params.ruleId,
      body,
      { id: actor.id, apiKeyId: apiKey.id },
      current.configurationRevision,
      tx
    );
    return ruleResult(await requireRule(tx!, params.id, params.ruleId));
  },
});
