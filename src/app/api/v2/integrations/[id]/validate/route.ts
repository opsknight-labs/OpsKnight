import { z } from 'zod';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { AppError } from '@/lib/errors';
import prisma from '@/lib/prisma';

export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.INTEGRATION_TEST,
  paramsSchema: z.object({ id: z.string().min(1) }),
  querySchema: z.object({}).strict(),
  handler: async ({ params, actor }) => {
    const integration = await prisma.integration.findUnique({ where: { id: params.id }, select: { id: true, type: true, enabled: true, snsTopicArn: true, revision: true, service: { select: { teamId: true } } } });
    if (!integration) throw new AppError({ code: 'INTEGRATION_NOT_FOUND' });
    const { enforceV2Authorization } = await import('@/lib/api-v2');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.INTEGRATION_TEST, { type: 'service', teamId: integration.service.teamId });
    const checks = [
      { code: 'SUPPORTED_TYPE', valid: true },
      { code: 'REQUIRED_CONFIGURATION', valid: integration.type !== 'CLOUDWATCH' || Boolean(integration.snsTopicArn && /^arn:(aws|aws-us-gov|aws-cn):sns:[a-z0-9-]+:\d{12}:[A-Za-z0-9_-]{1,256}$/.test(integration.snsTopicArn)) },
    ];
    return { data: { id: integration.id, type: integration.type, valid: checks.every(check => check.valid), checks, activationAllowed: checks.every(check => check.valid), revision: integration.revision }, headers: { 'Cache-Control': 'no-store' } };
  },
});
