import { z } from 'zod';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { DraftParams } from '@/lib/api-v2/runbook-authoring';
import { getVersionImpact } from '@/lib/runbooks/version-impact';
import { projectRunbookImpact } from '@/lib/api-v2/runbook-lifecycle';
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_MANAGE,
  paramsSchema: DraftParams,
  querySchema: z.object({ baseVersionId: z.string().cuid() }).strict(),
  handler: async ({ params, query }) => ({
    data: projectRunbookImpact(
      await getVersionImpact(params.id, query.baseVersionId, params.versionId)
    ),
  }),
});
