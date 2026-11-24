import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { simulateFailure } from '@/lib/intelligence/dependencies/insights/service';

/** Same what-if as a GET (comma-separated ids, up to 20) for tools that only read. */
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_READ,
  scopedFilter: true,
  rateLimitTier: 'SEARCH_EXPORT',
  querySchema: z
    .object({
      serviceIds: z
        .string()
        .trim()
        .min(1)
        .max(2200)
        .transform(value => value.split(',').map(id => id.trim()).filter(Boolean)),
      maxDepth: z.coerce.number().int().min(1).max(10).default(5),
    })
    .strict(),
  handler: async ({ actor, query }) => ({
    data: await simulateFailure(actor, query.serviceIds, { maxDepth: query.maxDepth }),
    headers: { 'Cache-Control': 'no-store' },
  }),
});

/** Read-only what-if: nothing is created or changed. */
export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_READ,
  scopedFilter: true,
  rateLimitTier: 'SEARCH_EXPORT',
  querySchema: z.object({}).strict(),
  bodySchema: z
    .object({
      serviceIds: z.array(z.string().trim().min(1).max(100)).min(1).max(20),
      maxDepth: z.number().int().min(1).max(10).default(5),
    })
    .strict(),
  handler: async ({ actor, body }) => ({
    data: await simulateFailure(actor, body.serviceIds, { maxDepth: body.maxDepth }),
    headers: { 'Cache-Control': 'no-store' },
  }),
});
