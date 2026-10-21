import { z } from 'zod';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { etagHeaders, preconditionFailed, requireRevisionIfMatch } from '@/lib/api-v2/concurrency';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { saveSupportHoursPolicy } from '@/lib/incidents/support-hours-policy';
import { IncidentResponsePolicyError } from '@/lib/incident-sla/policy-config';
import { AppError } from '@/lib/errors';

const paramsSchema = z.object({ id: z.string().trim().min(1).max(100) }).strict();
const bodySchema = z.object({
  timezone: z.string().trim().min(1).max(100),
  inheritWorkspace: z.boolean(),
  mode: z.enum(['INHERIT', 'ALWAYS', 'SCHEDULED']).optional(),
  windows: z.array(z.unknown()).max(28),
  exceptions: z.array(z.unknown()).max(366),
}).strict();

type Policy = Awaited<ReturnType<typeof saveSupportHoursPolicy>>;

function policyDto(policy: Policy) {
  return {
    scopeKey: policy.scopeKey,
    version: policy.version,
    timezone: policy.timezone,
    inheritWorkspace: policy.inheritWorkspace,
    mode: policy.mode,
    windows: policy.windows.map(window => ({
      dayOfWeek: window.dayOfWeek,
      startMinute: window.startMinute,
      endMinute: window.endMinute,
    })),
    exceptions: policy.exceptions.map(exception => ({
      localDate: exception.localDate.toISOString().slice(0, 10),
      available: exception.available,
      startMinute: exception.startMinute,
      endMinute: exception.endMinute,
      label: exception.label,
    })),
  };
}

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RESPONSE_POLICY_READ,
  paramsSchema,
  querySchema: z.object({}).strict(),
  handler: async ({ params }) => {
    const exists = await prisma.service.findUnique({ where: { id: params.id }, select: { id: true } });
    if (!exists) throw new AppError({ code: 'SERVICE_NOT_FOUND' });
    const policy = await prisma.responseSupportHoursPolicy.findFirst({
      where: { scopeKey: `service:${params.id}`, sealedAt: { not: null } },
      orderBy: { version: 'desc' },
      include: { windows: true, exceptions: true },
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
  handler: async ({ req, params, body, actor, apiKey, tx }) => {
    const expectedVersion = requireRevisionIfMatch(req);
    try {
      const policy = await saveSupportHoursPolicy(
        { ...body, scopeKey: `service:${params.id}`, expectedVersion },
        { actorId: actor.id, capabilities: ['admin.manage'], source: 'API', apiClientId: apiKey.id },
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
