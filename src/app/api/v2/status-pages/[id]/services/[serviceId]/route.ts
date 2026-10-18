import { readStatusPageConfigurationReplay } from '@/lib/status-pages/publish-configuration';
import prisma from '@/lib/prisma';
import { z } from 'zod';
import { AppError } from '@/lib/errors';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { etagHeaders, requireRevisionIfMatch, preconditionFailed } from '@/lib/api-v2/concurrency';
import {
  requireStatusPageIdempotency,
  StatusPageServiceParams,
  StatusPageServicePresentation,
  requireStatusPageSettings,
} from '@/lib/api-v2/status-page-settings';
import { saveStatusPageSection } from '@/lib/status-pages/settings-command';
export const PATCH = defineV2Route({
  action: AUTHORIZATION_ACTIONS.STATUS_PAGE_MANAGE,
  paramsSchema: StatusPageServiceParams,
  querySchema: z.object({}).strict(),
  bodySchema: StatusPageServicePresentation.refine(
    value => Object.keys(value).length > 0,
    'Provide a presentation setting.'
  ),
  preconditionRequired: true,
  handler: async ({ params, body, actor, apiKey, req }) => {
    const expected = requireRevisionIfMatch(req);
    const idempotency = requireStatusPageIdempotency(req, apiKey.id, body, expected);
    const replay = await readStatusPageConfigurationReplay(params.id, idempotency);
    if (replay) return { data: replay, headers: { ...etagHeaders(replay.revision), 'Idempotency-Replayed': 'true', 'Cache-Control': 'no-store' } };
    const page = await requireStatusPageSettings(prisma, params.id);
    if (page.revision !== expected) throw preconditionFailed();
    const rows = await prisma.statusPageService.findMany({
      where: { statusPageId: params.id },
      select: { serviceId: true, displayName: true, order: true, showOnPage: true },
      take: 10001,
    });
    if (rows.length > 10000)
      throw new AppError({
        code: 'RESOURCE_CONFLICT',
        userMessage: 'Page service configuration exceeds the supported edit bound.',
      });
    if (!rows.some(row => row.serviceId === params.serviceId))
      throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
    const serviceConfigs = Object.fromEntries(
      rows.map(row => [
        row.serviceId,
        {
          displayName: row.displayName,
          order: row.order,
          showOnPage: row.showOnPage,
          ...(row.serviceId === params.serviceId ? body : {}),
        },
      ])
    );
    const result = await saveStatusPageSection(
      params.id,
      { serviceIds: rows.map(row => row.serviceId), serviceConfigs },
      { id: actor.id, apiClientId: apiKey.id },
      expected,
      'services',
      idempotency
    );
    return {
      data: result,
      headers: { ...etagHeaders(result.revision), 'Cache-Control': 'no-store', ...(result.replayed ? { 'Idempotency-Replayed': 'true' } : {}) },
    };
  },
});
