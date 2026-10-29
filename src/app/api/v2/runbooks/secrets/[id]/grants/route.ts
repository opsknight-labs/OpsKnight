import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { etagHeaders, requireRevisionIfMatch } from '@/lib/api-v2/concurrency';
import { PaginationQuerySchema } from '@/lib/api-v2/validation';
import { buildCursorWhere, formatCursorPagination } from '@/lib/api-v2/pagination';
import { grantRunbookSecret, secretGrantTargetSchema } from '@/lib/runbooks/secrets';
const Params = z.object({ id: z.string().cuid() }).strict();
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_SECRET_READ,
  paramsSchema: Params,
  querySchema: PaginationQuerySchema.strict(),
  handler: async ({ params, pagination }) => {
    if (
      !(await prisma.runbookSecret.findUnique({ where: { id: params.id }, select: { id: true } }))
    )
      throw new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'Runbook secret not found.' });
    const rows = await prisma.runbookSecretGrant.findMany({
      where: { secretId: params.id, ...buildCursorWhere(pagination.cursor) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: pagination.limit + 1,
      select: { id: true, secretId: true, agentId: true, agentPoolId: true, createdAt: true },
    });
    const page = formatCursorPagination(rows, pagination.limit);
    return {
      data: page.data,
      pagination: page.pagination,
      headers: { 'Cache-Control': 'no-store' },
    };
  },
});
export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_SECRET_GRANT,
  paramsSchema: Params,
  querySchema: z.object({}).strict(),
  bodySchema: secretGrantTargetSchema,
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  handler: async ({ req, params, body, actor, apiKey, tx }) => {
    const grant = await grantRunbookSecret(
      params.id,
      body,
      { id: actor.id, apiKeyId: apiKey.id },
      { client: tx, expectedRevision: requireRevisionIfMatch(req) }
    );
    const secret = await tx!.runbookSecret.findUniqueOrThrow({
      where: { id: params.id },
      select: { revision: true },
    });
    return {
      data: {
        id: grant.id,
        secretId: grant.secretId,
        agentId: grant.agentId,
        agentPoolId: grant.agentPoolId,
        createdAt: grant.createdAt,
      },
      headers: { ...etagHeaders(secret.revision), 'Cache-Control': 'no-store' },
    };
  },
});
