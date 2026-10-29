import { z } from 'zod/v3';
import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { etagHeaders, preconditionFailed, requireRevisionIfMatch } from '@/lib/api-v2/concurrency';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { saveClassificationPolicy } from '@/lib/incidents/classification-policy';
import { IncidentResponsePolicyError } from '@/lib/incident-sla/policy-config';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';

const paramsSchema = z.object({ id: z.string().trim().min(1).max(100) }).strict();
const bodySchema = z
  .object({
    derivePriorityFromUrgency: z.boolean().optional(),
    priorityFallbackMode: z.enum(['INHERIT', 'ENABLED', 'DISABLED']).optional(),
    rules: z.array(z.unknown()).length(4),
  })
  .strict();

type Policy = Awaited<ReturnType<typeof saveClassificationPolicy>>;

function policyDto(policy: Policy) {
  return {
    scopeKey: policy.scopeKey,
    version: policy.version,
    derivePriorityFromUrgency: policy.derivePriorityFromUrgency,
    priorityFallbackMode: policy.priorityFallbackMode,
    rules: policy.rules.map(rule => ({
      matchValue: rule.matchValue,
      priorityMode: rule.priorityMode,
      priority: rule.priority,
      urgencyMode: rule.urgencyMode,
      urgency: rule.urgency,
    })),
  };
}

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RESPONSE_POLICY_READ,
  paramsSchema,
  querySchema: z.object({}).strict(),
  handler: async ({ params }) => {
    const exists = await prisma.service.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
    if (!exists) throw new AppError({ code: 'SERVICE_NOT_FOUND' });
    const policy = await prisma.incidentClassificationPolicy.findFirst({
      where: { scopeKey: `service:${params.id}`, sealedAt: { not: null } },
      orderBy: { version: 'desc' },
      include: { rules: true },
    });
    return {
      data: { policy: policy ? policyDto(policy) : null },
      headers: etagHeaders(policy?.version ?? 0),
    };
  },
});

export const PUT = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RESPONSE_POLICY_MANAGE,
  paramsSchema,
  querySchema: z.object({}).strict(),
  bodySchema,
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  replayAuthGuard: async ({ params, tx }) => {
    const exists = await tx!.service.findUnique({ where: { id: params.id }, select: { id: true } });
    if (!exists) throw new AppError({ code: 'SERVICE_NOT_FOUND' });
  },
  invalidateAfterCommit: () => {
    for (const path of ['/settings/incident-sla', '/settings', '/services', '/audit']) {
      try {
        revalidatePath(path);
      } catch (error) {
        // The policy and replay receipt have already committed; cache errors must not turn success into 500.
        logger.warn('api_v2.classification_cache_revalidation_failed', { path, error });
      }
    }
  },
  handler: async ({ req, params, body, actor, apiKey, tx }) => {
    const expectedVersion = requireRevisionIfMatch(req);
    try {
      const policy = await saveClassificationPolicy(
        { ...body, scopeKey: `service:${params.id}`, expectedVersion },
        'API',
        {
          actorId: actor.id,
          capabilities: ['admin.manage'],
          source: 'API',
          apiClientId: apiKey.id,
        },
        tx
      );
      return { data: { policy: policyDto(policy) }, headers: etagHeaders(policy.version) };
    } catch (error) {
      if (error instanceof IncidentResponsePolicyError) {
        if (error.code === 'CONFLICT') throw preconditionFailed();
        if (error.code === 'NOT_FOUND') throw new AppError({ code: 'SERVICE_NOT_FOUND' });
        if (error.code === 'UNAUTHORIZED') throw new AppError({ code: 'AUTHORIZATION_DENIED' });
      }
      throw error;
    }
  },
});
