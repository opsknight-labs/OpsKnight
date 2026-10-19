import { projectExecutionPreview } from '@/lib/api-v2/runbook-preview';
import prisma from '@/lib/prisma';
import { z } from 'zod';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { previewRunbookExecution } from '@/lib/runbooks/orchestrator';
import { ExecutionParams, requireRerunRequest } from '@/lib/api-v2/runbook-intervention';
export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_EXECUTE,
  paramsSchema: ExecutionParams,
  querySchema: z.object({}).strict(),
  bodySchema: z.object({}).strict(),
  rateLimitTier: 'SEARCH_EXPORT',
  handler: async ({ actor, apiKey, params }) => {
    const preview = await previewRunbookExecution(
      await requireRerunRequest(prisma, actor, params.id),
      undefined,
      { apiClientId: apiKey.id }
    );
    return {
      data: { ...projectExecutionPreview(preview), authorizationToken: preview.authorizationToken },
      headers: { 'Cache-Control': 'no-store' },
    };
  },
});
