import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { etagHeaders, requireRevisionIfMatch } from '@/lib/api-v2/concurrency';
import {
  executeIdempotentStatusPageSection,
  StatusPageParams,
  requireStatusPageSettings,
} from '@/lib/api-v2/status-page-settings';

async function projection(pageId: string) {
  const page = await requireStatusPageSettings(prisma, pageId);
  const rows = await prisma.statusPageBusinessService.findMany({
    where: { statusPageId: pageId },
    orderBy: { order: 'asc' },
    select: {
      businessServiceId: true,
      displayName: true,
      order: true,
      showOnPage: true,
      showMembers: true,
      statusOverride: true,
      statusOverrideUntil: true,
      businessService: { select: { name: true } },
    },
  });
  return {
    page,
    data: {
      statusPageId: pageId,
      serviceLayout: page.serviceLayout,
      businessServices: rows.map(row => ({
        businessServiceId: row.businessServiceId,
        name: row.displayName || row.businessService.name,
        displayName: row.displayName,
        order: row.order,
        showOnPage: row.showOnPage,
        showMembers: row.showMembers,
        statusOverride: row.statusOverride,
        statusOverrideUntil: row.statusOverrideUntil?.toISOString() ?? null,
      })),
    },
  };
}

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.STATUS_PAGE_READ,
  paramsSchema: StatusPageParams,
  querySchema: z.object({}).strict(),
  handler: async ({ params }) => {
    const { page, data } = await projection(params.id);
    return { data, headers: { ...etagHeaders(page.revision), 'Cache-Control': 'no-store' } };
  },
});

/**
 * Sets the layout, the ordered business services and (optionally) each one's display name,
 * visibility and member visibility. Runs through the shared publication
 * command, so removing a business service withdraws the page first, like any narrowing change.
 */
export const PUT = defineV2Route({
  action: AUTHORIZATION_ACTIONS.STATUS_PAGE_MANAGE,
  paramsSchema: StatusPageParams,
  querySchema: z.object({}).strict(),
  bodySchema: z
    .object({
      serviceLayout: z.enum(['FLAT', 'BUSINESS', 'BUSINESS_EXPANDABLE']),
      businessServiceIds: z.array(z.string().trim().min(1).max(100)).max(200),
      businessServiceConfigs: z
        .record(
          z
            .object({
              displayName: z.string().trim().max(200).nullable().optional(),
              showOnPage: z.boolean().optional(),
              showMembers: z.boolean().optional(),
            })
            .strict()
        )
        .optional(),
    })
    .strict(),
  preconditionRequired: true,
  handler: async ({ params, body, actor, apiKey, req }) => {
    const result = await executeIdempotentStatusPageSection(
      req,
      apiKey.id,
      params.id,
      body,
      { id: actor.id, apiClientId: apiKey.id },
      requireRevisionIfMatch(req),
      'services'
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
