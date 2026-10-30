import { z } from 'zod/v3';
import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { etagHeaders, preconditionFailed, requireRevisionIfMatch } from '@/lib/api-v2/concurrency';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import {
  saveIncidentSlaPolicy,
  IncidentResponsePolicyError,
} from '@/lib/incident-sla/policy-config';
import { MAX_INCIDENT_SLA_TARGET_MS } from '@/lib/incident-sla/policy-validation';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';

const paramsSchema = z.object({ id: z.string().trim().min(1).max(100) }).strict();
const target = z.number().int().positive().max(MAX_INCIDENT_SLA_TARGET_MS);
const bodySchema = z
  .object({
    inheritWorkspace: z.boolean(),
    baseAckTargetMs: target.nullable(),
    baseResolveTargetMs: target.nullable(),
    rules: z
      .array(
        z
          .object({
            priority: z.enum(['P1', 'P2', 'P3', 'P4', 'P5']),
            ackTargetMs: target,
            resolveTargetMs: target,
            label: z.string().trim().max(120).optional(),
          })
          .strict()
      )
      .max(5),
  })
  .strict();
type Policy = Awaited<ReturnType<typeof saveIncidentSlaPolicy>>;

function policyDto(policy: Policy) {
  return {
    scopeKey: policy.scopeKey,
    version: policy.version,
    inheritWorkspace: policy.inheritWorkspace,
    baseAckTargetMs: policy.baseAckTargetMs,
    baseResolveTargetMs: policy.baseResolveTargetMs,
    rules: policy.rules.map(rule => ({
      priority: rule.priority,
      ackTargetMs: rule.ackTargetMs,
      resolveTargetMs: rule.resolveTargetMs,
      label: rule.label,
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
    const policy = await prisma.incidentSlaPolicy.findFirst({
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
        logger.warn('api_v2.sla_cache_revalidation_failed', { path, error });
      }
    }
  },
  handler: async ({ req, params, body, actor, apiKey, tx }) => {
    const expectedVersion = requireRevisionIfMatch(req);
    try {
      const policy = await saveIncidentSlaPolicy(
        { ...body, scopeKey: `service:${params.id}`, expectedVersion },
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
