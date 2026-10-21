import { z } from 'zod';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { etagHeaders } from '@/lib/api-v2/concurrency';
import { projectRunbookSecret, runbookSecretMetadataSelect } from '@/lib/runbooks/secrets';
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_SECRET_READ,
  paramsSchema: z.object({ id: z.string().cuid() }).strict(),
  querySchema: z.object({}).strict(),
  handler: async ({ params }) => {
    const secret = await prisma.runbookSecret.findUnique({
      where: { id: params.id },
      select: runbookSecretMetadataSelect,
    });
    if (!secret)
      throw new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'Runbook secret not found.' });
    return {
      data: projectRunbookSecret(secret),
      headers: { ...etagHeaders(secret.revision), 'Cache-Control': 'no-store' },
    };
  },
});
