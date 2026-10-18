import { z } from 'zod';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { StatusSubscriberPageParams } from '@/lib/api-v2/status-page-subscribers';
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.STATUS_PAGE_READ,
  paramsSchema: StatusSubscriberPageParams,
  querySchema: z.object({}).strict(),
  handler: async ({ params }) => {
    const page = await prisma.statusPage.findUnique({
      where: { id: params.id },
      select: { id: true, enabled: true, showSubscribe: true },
    });
    if (!page) throw new AppError({ code: 'STATUS_PAGE_NOT_FOUND' });
    return {
      data: {
        statusPageId: page.id,
        enabled: page.enabled,
        showSubscribe: page.showSubscribe,
        verificationRequired: true,
        publicRegistrationSeparate: true,
      },
      headers: { 'Cache-Control': 'no-store' },
    };
  },
});
