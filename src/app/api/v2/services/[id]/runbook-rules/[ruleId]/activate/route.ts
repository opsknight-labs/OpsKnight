import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { activateServiceRule } from '@/lib/runbooks/bindings';
import {
  RuleParams,
  requireRule,
  ruleResult,
  RuleActivationBody,
} from '@/lib/api-v2/runbook-rules';
export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_RULE_ACTIVATE,
  paramsSchema: RuleParams,
  querySchema: z.object({}).strict(),
  bodySchema: RuleActivationBody,
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  handler: async ({ params, req, body, actor, apiKey, tx }) => {
    await requireRule(tx!, params.id, params.ruleId, req);
    await activateServiceRule(
      params.id,
      params.ruleId,
      { id: actor.id, apiKeyId: apiKey.id },
      body.confirmMatchAll,
      tx
    );
    return ruleResult(await requireRule(tx!, params.id, params.ruleId));
  },
});
