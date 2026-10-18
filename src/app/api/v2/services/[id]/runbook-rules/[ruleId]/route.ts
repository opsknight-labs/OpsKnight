import { z } from 'zod';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { RuleParams, RuleUpdateBody, requireRule, ruleResult } from '@/lib/api-v2/runbook-rules';
import { updateServiceBinding, detachServiceBinding } from '@/lib/runbooks/bindings';
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_RULE_READ,
  paramsSchema: RuleParams,
  querySchema: z.object({}).strict(),
  handler: async ({ params }) => ruleResult(await requireRule(prisma, params.id, params.ruleId)),
});
export const PATCH = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_RULE_MANAGE,
  paramsSchema: RuleParams,
  querySchema: z.object({}).strict(),
  bodySchema: RuleUpdateBody,
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  handler: async ({ params, req, body, actor, apiKey, tx }) => {
    const current = await requireRule(tx!, params.id, params.ruleId, req);
    await updateServiceBinding(
      params.id,
      params.ruleId,
      body.configuration,
      { id: actor.id, apiKeyId: apiKey.id },
      body.expectedVersionId,
      current.configurationRevision,
      tx
    );
    return ruleResult(await requireRule(tx!, params.id, params.ruleId));
  },
});
export const DELETE = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_RULE_MANAGE,
  paramsSchema: RuleParams,
  querySchema: z.object({}).strict(),
  bodySchema: z.object({}).strict(),
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  handler: async ({ params, req, actor, apiKey, tx }) => {
    await requireRule(tx!, params.id, params.ruleId, req);
    await detachServiceBinding(params.id, params.ruleId, { id: actor.id, apiKeyId: apiKey.id }, tx);
    return { status: 204 };
  },
});
