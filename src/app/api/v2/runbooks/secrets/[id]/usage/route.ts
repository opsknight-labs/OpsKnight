import { secretUsageQuery, type SecretUsage } from '@/lib/runbooks/secret-usage';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { PaginationQuerySchema } from '@/lib/api-v2/validation';
import { decodeCursor, formatCursorPagination } from '@/lib/api-v2/pagination';

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_SECRET_READ,
  paramsSchema: z.object({ id: z.string().cuid() }).strict(),
  querySchema: PaginationQuerySchema.strict(),
  rateLimitTier: 'SEARCH_EXPORT',
  handler: async ({ params, pagination }) => {
    const secret = await prisma.runbookSecret.findUnique({
      where: { id: params.id },
      select: { name: true },
    });
    if (!secret)
      throw new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'Runbook secret not found.' });
    const reference = `secret://${secret.name}`;
    const cursor = pagination.cursor ? decodeCursor(pagination.cursor) : null;
    const page = await prisma.$transaction(
      async tx => {
        await tx.$executeRaw`SET LOCAL statement_timeout = '2000ms'`;
        const rows = await tx.$queryRaw<SecretUsage[]>(
          secretUsageQuery(reference, pagination.limit, cursor)
        );
        return formatCursorPagination(rows, pagination.limit);
      },
      { timeout: 5000, maxWait: 1000 }
    );
    return {
      data: page.data,
      pagination: page.pagination,
      headers: { 'Cache-Control': 'no-store' },
    };
  },
});
