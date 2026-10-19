import { AUTHORIZATION_ACTIONS, authorize } from '@/lib/authorization-policy';
import { resolvedPlanDigest } from '@/lib/runbooks/orchestrator';
import { resolvedApprovalPlan } from '@/lib/runbooks/approval-plan';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import {
  ExecutionParams,
  requireReadableExecution,
  canControlExecution,
} from '@/lib/api-v2/runbook-intervention';
import { PaginationQuerySchema } from '@/lib/api-v2/validation';
import { buildCursorWhere, formatCursorPagination } from '@/lib/api-v2/pagination';
import { redactRunbookDisplayName } from '@/lib/runbooks/display-name';
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_READ,
  scopedFilter: true,
  paramsSchema: ExecutionParams,
  querySchema: PaginationQuerySchema.strict(),
  handler: async ({ actor, params, pagination }) => {
    const execution = await requireReadableExecution(prisma, actor, params.id);
    const canReview =
      canControlExecution(actor, execution) &&
      authorize({ actor, action: AUTHORIZATION_ACTIONS.RUNBOOK_APPROVE }).allowed;
    const context = canReview
      ? await prisma.runbookExecution.findUniqueOrThrow({
          where: { id: params.id },
          select: {
            definitionChecksum: true,
            inputValues: true,
            resolvedTargetAgentId: true,
            resolvedTargetAgentPoolId: true,
          },
        })
      : null;
    const rows = await prisma.runbookExecutionStep.findMany({
      where: { AND: [{ executionId: params.id }, buildCursorWhere(pagination.cursor)] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: pagination.limit + 1,
    });
    const result = formatCursorPagination(rows, pagination.limit);
    return {
      data: result.data.map(row => ({
        id: row.id,
        stepKey: row.stepKey,
        sequence: row.sequence,
        name: redactRunbookDisplayName(row.name),
        type: row.type,
        riskClass: row.riskClass,
        status: row.status,
        requiresApproval: row.requiresApproval,
        approvedAt: row.approvedAt,
        attemptCount: row.attemptCount,
        startedAt: row.startedAt,
        completedAt: row.completedAt,
        createdAt: row.createdAt,
        pendingApproval:
          context && row.status === 'WAITING_APPROVAL'
            ? {
                planDigest: resolvedPlanDigest(row, context),
                plan: resolvedApprovalPlan(
                  row.type,
                  row.config as Record<string, unknown>,
                  context.inputValues as Record<string, unknown>
                ),
                timeoutSeconds: row.timeoutSeconds ?? 300,
              }
            : null,
      })),
      pagination: result.pagination,
      headers: { 'Cache-Control': 'no-store' },
    };
  },
});
