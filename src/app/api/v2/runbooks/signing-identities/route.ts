import { z } from 'zod';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import {
  SigningKeySelect,
  guardActiveSigningIdentity,
  signingCommand,
} from '@/lib/api-v2/runbook-signing';
import { stageExecutionSigningKey } from '@/lib/runbooks/execution-signing';
import { PaginationQuerySchema } from '@/lib/api-v2/validation';
import { buildCursorWhere, formatCursorPagination } from '@/lib/api-v2/pagination';
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_SIGNING_READ,
  querySchema: PaginationQuerySchema.strict(),
  handler: async ({ pagination }) => {
    const rows = await prisma.runbookExecutionSigningKey.findMany({
      where: buildCursorWhere(pagination.cursor),
      select: SigningKeySelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: pagination.limit + 1,
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
  action: AUTHORIZATION_ACTIONS.RUNBOOK_SIGNING_MANAGE,
  querySchema: z.object({}).strict(),
  bodySchema: z.object({ expectedActiveKeyId: z.string().min(1).max(100).nullable() }).strict(),
  idempotent: true,
  idempotencyRequired: true,
  handler: async ({ body, actor, apiKey, tx }) =>
    signingCommand(async () => {
      await guardActiveSigningIdentity(tx!, body.expectedActiveKeyId);
      const key = await stageExecutionSigningKey({ id: actor.id, apiKeyId: apiKey.id }, tx);
      const data = await tx!.runbookExecutionSigningKey.findUniqueOrThrow({
        where: { id: key.id },
        select: SigningKeySelect,
      });
      return { status: 201, data, headers: { 'Cache-Control': 'no-store' } };
    }),
});
