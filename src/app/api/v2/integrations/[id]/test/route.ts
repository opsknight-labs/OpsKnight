import { z } from 'zod';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { IntegrationTestV2Schema } from '@/lib/api-v2/validation';
import { AppError } from '@/lib/errors';
import { StandardEventSchema, IntegrationSchemas } from '@/lib/integrations/schemas';
import prisma from '@/lib/prisma';

const paramsSchema = z.object({ id: z.string().min(1) });
export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.INTEGRATION_TEST,
  paramsSchema,
  bodySchema: IntegrationTestV2Schema,
  rateLimitTier: 'SEARCH_EXPORT',
  handler: async ({ params, body, actor }) => {
    const integration = await prisma.integration.findUnique({ where: { id: params.id }, select: { id: true, type: true, service: { select: { teamId: true } } } });
    if (!integration) throw new AppError({ code: 'INTEGRATION_NOT_FOUND' });
    const { enforceV2Authorization } = await import('@/lib/api-v2');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.INTEGRATION_TEST, { type: 'service', teamId: integration.service.teamId });
    const sample = body.payload ?? { event_action: 'trigger', dedup_key: 'diagnostic-only', payload: { summary: 'Integration validation sample', source: 'api-diagnostic', severity: 'info' } };
    const schema = integration.type === 'EVENTS_API_V2' ? StandardEventSchema : IntegrationSchemas[integration.type as keyof typeof IntegrationSchemas];
    if (!schema) throw new AppError({ code: 'VALIDATION_FAILED', userMessage: 'This integration type does not support sample validation.' });
    const parsed = schema.safeParse(sample);
    return { data: { valid: parsed.success, provider: integration.type, errors: parsed.success ? [] : parsed.error.issues.slice(0, 50).map(issue => ({ path: issue.path.join('.').slice(0, 200), message: issue.message.slice(0, 300) })) }, headers: { 'Cache-Control': 'no-store' } };
  },
});
