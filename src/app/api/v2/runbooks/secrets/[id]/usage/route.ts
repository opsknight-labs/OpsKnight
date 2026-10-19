import { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { PaginationQuerySchema } from '@/lib/api-v2/validation';
import { decodeCursor, formatCursorPagination } from '@/lib/api-v2/pagination';

type SecretUsage = {
  id: string;
  sourceType: 'SERVICE_RULE' | 'EXECUTION' | 'INPUT_DEFAULT';
  sourceId: string;
  runbookId: string;
  runbookVersionId: string | null;
  serviceId: string | null;
  createdAt: Date;
};
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
        const rows = await tx.$queryRaw<SecretUsage[]>(Prisma.sql`
    SELECT * FROM (
      SELECT 'rule:' || r.id AS id, 'SERVICE_RULE'::text AS "sourceType", r.id AS "sourceId", r."runbookId", r."runbookVersionId", r."serviceId", r."createdAt"
       FROM "ServiceRunbookBinding" r WHERE jsonb_path_query_array(r."inputValues", '$.*') @> ${JSON.stringify([reference])}::jsonb
      UNION ALL
      SELECT 'execution:' || e.id, 'EXECUTION'::text, e.id, e."runbookId", e."runbookVersionId", e."serviceId", e."createdAt"
       FROM "RunbookExecution" e WHERE jsonb_path_query_array(e."inputValues", '$.*') @> ${JSON.stringify([reference])}::jsonb
      UNION ALL
      SELECT 'default:' || i.id, 'INPUT_DEFAULT'::text, i.id, v."runbookId", i."runbookVersionId", NULL::text, i."createdAt"
       FROM "RunbookInput" i JOIN "RunbookVersion" v ON v.id = i."runbookVersionId"
       WHERE i.type = 'SECRET_REF' AND i."defaultValue" = ${reference}
    ) usage
    ${cursor ? Prisma.sql`WHERE ("createdAt", id) < (${new Date(cursor.createdAt)}, ${cursor.id})` : Prisma.empty}
    ORDER BY "createdAt" DESC, id DESC LIMIT ${pagination.limit + 1}
   `);
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
