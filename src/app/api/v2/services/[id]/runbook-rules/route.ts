import { z } from 'zod';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import {
  RuleServiceParams,
  RuleCreateBody,
  requireRuleService,
  requireRule,
  projectRuleSummary,
  ruleResult,
} from '@/lib/api-v2/runbook-rules';
import { PaginationQuerySchema } from '@/lib/api-v2/validation';
import { buildCursorWhere, formatCursorPagination } from '@/lib/api-v2/pagination';
import { createServiceBinding } from '@/lib/runbooks/bindings';
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_RULE_READ,
  paramsSchema: RuleServiceParams,
  querySchema: PaginationQuerySchema.strict(),
  handler: async ({ params, pagination }) => {
    await requireRuleService(prisma, params.id);
    const rows = await prisma.serviceAutomationRule.findMany({
      where: {
        AND: [{ serviceId: params.id, detachedAt: null }, buildCursorWhere(pagination.cursor)],
      },
      select: {
        id: true,
        serviceId: true,
        runbookId: true,
        name: true,
        configurationRevision: true,
        enabled: true,
        mode: true,
        versionStrategy: true,
        runbookVersionId: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: pagination.limit + 1,
    });
    const result = formatCursorPagination(rows, pagination.limit);
    return {
      data: result.data.map(projectRuleSummary),
      pagination: result.pagination,
      headers: { 'Cache-Control': 'no-store' },
    };
  },
});
export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_RULE_MANAGE,
  paramsSchema: RuleServiceParams,
  querySchema: z.object({}).strict(),
  bodySchema: RuleCreateBody,
  idempotent: true,
  idempotencyRequired: true,
  handler: async ({ params, body, actor, apiKey, tx }) => {
    await requireRuleService(tx!, params.id);
    const rule = await createServiceBinding(
      params.id,
      body.configuration,
      { id: actor.id, apiKeyId: apiKey.id },
      body.trigger,
      body.expectedVersionId,
      tx
    );
    return { status: 201, ...ruleResult(await requireRule(tx!, params.id, rule.id)) };
  },
});
