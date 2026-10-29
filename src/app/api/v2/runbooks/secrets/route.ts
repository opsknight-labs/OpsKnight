import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { fingerprintV2SensitiveValue } from '@/lib/api-v2/auth';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { etagHeaders } from '@/lib/api-v2/concurrency';
import { PaginationQuerySchema } from '@/lib/api-v2/validation';
import { buildCursorWhere, formatCursorPagination } from '@/lib/api-v2/pagination';
import { createRunbookSecretSchema } from '@/lib/runbooks/schemas';
import {
  createRunbookSecret,
  projectRunbookSecret,
  runbookSecretMetadataSelect,
} from '@/lib/runbooks/secrets';
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_SECRET_READ,
  querySchema: PaginationQuerySchema.strict(),
  handler: async ({ pagination }) => {
    const rows = await prisma.runbookSecret.findMany({
      where: buildCursorWhere(pagination.cursor),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: pagination.limit + 1,
      select: runbookSecretMetadataSelect,
    });
    const page = formatCursorPagination(rows, pagination.limit);
    return {
      data: page.data.map(projectRunbookSecret),
      pagination: page.pagination,
      headers: { 'Cache-Control': 'no-store' },
    };
  },
});
export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_SECRET_MANAGE,
  querySchema: z.object({}).strict(),
  bodySchema: createRunbookSecretSchema,
  idempotent: true,
  idempotencyRequired: true,
  idempotencyPayload: ({ req, body }) => ({
    name: body.name,
    description: body.description,
    valueFingerprint: fingerprintV2SensitiveValue(req, body.value),
  }),
  handler: async ({ body, actor, apiKey, tx }) => {
    const secret = await createRunbookSecret(body, { id: actor.id, apiKeyId: apiKey.id }, tx);
    return {
      status: 201,
      data: secret,
      headers: {
        ...etagHeaders(secret.revision),
        'Cache-Control': 'no-store',
        Location: `/api/v2/runbooks/secrets/${secret.id}`,
      },
    };
  },
});
