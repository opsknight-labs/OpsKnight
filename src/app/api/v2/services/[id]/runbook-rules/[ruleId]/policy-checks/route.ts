import { z } from 'zod';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { RuleParams, requireRule } from '@/lib/api-v2/runbook-rules';
import { requestRulePolicyChecks } from '@/lib/runbooks/policy-checks';
import { PaginationQuerySchema } from '@/lib/api-v2/validation';
import { buildCursorWhere, formatCursorPagination } from '@/lib/api-v2/pagination';
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_RULE_READ,
  paramsSchema: RuleParams,
  querySchema: PaginationQuerySchema.strict(),
  handler: async ({ params, pagination }) => {
    await requireRule(prisma, params.id, params.ruleId);
    const rows = await prisma.runbookPolicyCheck.findMany({
      where: { AND: [{ ruleId: params.ruleId }, buildCursorWhere(pagination.cursor)] },
      select: {
        id: true,
        ruleId: true,
        agentId: true,
        versionId: true,
        checksum: true,
        status: true,
        expiresAt: true,
        checkedAt: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: pagination.limit + 1,
    });
    const result = formatCursorPagination(rows, pagination.limit);
    return {
      data: result.data,
      pagination: result.pagination,
      headers: { 'Cache-Control': 'no-store' },
    };
  },
});
export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_RULE_ACTIVATE,
  paramsSchema: RuleParams,
  querySchema: z.object({}).strict(),
  bodySchema: z.object({}).strict(),
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  handler: async ({ params, req, actor, apiKey, tx }) => {
    await requireRule(tx!, params.id, params.ruleId, req);
    return {
      status: 202,
      data: await requestRulePolicyChecks(
        params.id,
        params.ruleId,
        { id: actor.id, apiKeyId: apiKey.id },
        tx
      ),
    };
  },
});
