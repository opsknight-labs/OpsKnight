import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { etagHeaders, preconditionFailed, requireRevisionIfMatch } from '@/lib/api-v2/concurrency';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { saveIncidentSlaPolicy, IncidentResponsePolicyError } from '@/lib/incident-sla/policy-config';
import { MAX_INCIDENT_SLA_TARGET_MS } from '@/lib/incident-sla/policy-validation';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';

const target = z.number().int().positive().max(MAX_INCIDENT_SLA_TARGET_MS);
const bodySchema = z.object({
  baseAckTargetMs: target,
  baseResolveTargetMs: target,
  rules: z.array(z.object({
    priority: z.enum(['P1', 'P2', 'P3', 'P4', 'P5']),
    ackTargetMs: target,
    resolveTargetMs: target,
    label: z.string().trim().max(120).optional(),
  }).strict()).max(5),
}).strict();
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
  querySchema: z.object({}).strict(),
  handler: async () => {
    const policy = await prisma.incidentSlaPolicy.findFirst({
      where: { scopeKey: 'workspace', sealedAt: { not: null } },
      orderBy: { version: 'desc' },
      include: { rules: true },
    });
    return {
      data: { policy: policy ? policyDto(policy) : null },
      headers: { ...etagHeaders(policy?.version ?? 0), 'Cache-Control': 'no-store' },
    };
  },
});

export const PUT = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RESPONSE_POLICY_MANAGE,
  querySchema: z.object({}).strict(),
  bodySchema,
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  idempotencyScope: 'settings:incident-sla',
  invalidateAfterCommit: () => {
    for (const path of ['/settings/incident-sla', '/settings', '/audit']) {
      try {
        revalidatePath(path);
      } catch (error) {
        logger.warn('api_v2.workspace_sla_cache_revalidation_failed', { path, error });
      }
    }
  },
  handler: async ({ req, body, actor, apiKey, tx }) => {
    const expectedVersion = requireRevisionIfMatch(req);
    try {
      const policy = await saveIncidentSlaPolicy(
        { ...body, scopeKey: 'workspace', expectedVersion, inheritWorkspace: false },
        { actorId: actor.id, capabilities: ['admin.manage'], source: 'API', apiClientId: apiKey.id },
        tx
      );
      return {
        data: { policy: policyDto(policy) },
        headers: { ...etagHeaders(policy.version), 'Cache-Control': 'no-store' },
      };
    } catch (error) {
      if (error instanceof IncidentResponsePolicyError) {
        if (error.code === 'CONFLICT') throw preconditionFailed();
        if (error.code === 'UNAUTHORIZED') throw new AppError({ code: 'AUTHORIZATION_DENIED' });
      }
      throw error;
    }
  },
});
