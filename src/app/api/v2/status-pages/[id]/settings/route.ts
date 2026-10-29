import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { etagHeaders, requireRevisionIfMatch } from '@/lib/api-v2/concurrency';
import {
  executeIdempotentStatusPageSection,
  StatusPageParams,
  statusPageSectionSchema,
  requireStatusPageSettings,
  projectStatusPageSection,
} from '@/lib/api-v2/status-page-settings';
import { z } from 'zod/v3';

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.STATUS_PAGE_READ,
  paramsSchema: StatusPageParams,
  querySchema: z.object({}).strict(),
  handler: async ({ params }) => {
    const page = await requireStatusPageSettings(prisma, params.id);
    return {
      data: projectStatusPageSection(page, 'general'),
      headers: { ...etagHeaders(page.revision), 'Cache-Control': 'no-store' },
    };
  },
});
export const PATCH = defineV2Route({
  action: AUTHORIZATION_ACTIONS.STATUS_PAGE_MANAGE,
  paramsSchema: StatusPageParams,
  querySchema: z.object({}).strict(),
  bodySchema: statusPageSectionSchema('general'),
  preconditionRequired: true,
  handler: async ({ params, body, actor, apiKey, req }) => {
    const result = await executeIdempotentStatusPageSection(
      req,
      apiKey.id,
      params.id,
      body,
      { id: actor.id, apiClientId: apiKey.id },
      requireRevisionIfMatch(req),
      'general'
    );
    return {
      data: result,
      headers: {
        ...etagHeaders(result.revision),
        'Cache-Control': 'no-store',
        ...(result.replayed ? { 'Idempotency-Replayed': 'true' } : {}),
      },
    };
  },
});
