import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { ImpactWindowQuerySchema } from '@/lib/business-services/api';
import { listBusinessServiceChanges } from '@/lib/business-services/changes';

const QuerySchema = z
  .object({
    from: z.string().optional(),
    to: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict()
  .transform((query, ctx) => {
    const window = ImpactWindowQuerySchema.safeParse({ from: query.from, to: query.to });
    if (!window.success) {
      for (const issue of window.error.issues)
        ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
      return z.NEVER;
    }
    return { window: window.data, limit: query.limit };
  });

/** Changes on the member services of a business service in the window, newest first. */
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_READ,
  // The handler filters to the actor's business services and readable changes.
  scopedFilter: true,
  paramsSchema: z.object({ id: z.string().trim().min(1).max(100) }).strict(),
  querySchema: QuerySchema,
  handler: async ({ actor, params, query }) => ({
    data: await listBusinessServiceChanges(params.id, query.window, actor, query.limit),
    headers: { 'Cache-Control': 'no-store' },
  }),
});
