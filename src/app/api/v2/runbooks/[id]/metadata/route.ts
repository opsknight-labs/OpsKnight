import { z } from 'zod';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { RunbookParams } from '@/lib/api-v2/runbook-authoring';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { runbookMetadataResult } from '@/lib/api-v2/runbook-lifecycle';
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_MANAGE,
  paramsSchema: RunbookParams,
  querySchema: z.object({}).strict(),
  handler: async ({ params }) => {
    const runbook = await prisma.runbook.findUnique({ where: { id: params.id } });
    if (!runbook) throw new AppError({ code: 'RUNBOOK_NOT_FOUND' });
    return runbookMetadataResult(runbook);
  },
});
