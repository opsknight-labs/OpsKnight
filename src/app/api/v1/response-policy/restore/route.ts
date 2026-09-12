import type { NextRequest } from 'next/server';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { jsonError, jsonOk } from '@/lib/api-response';
import { authorizeResponsePolicyApi } from '@/lib/response-policy-api-auth';
import { saveClassificationPolicy } from '@/lib/incidents/classification-policy';
import { responsePolicyError } from '@/lib/response-policy-http';
import { saveIncidentSlaPolicy } from '@/lib/incident-sla/policy-config';
import { saveSupportHoursPolicy } from '@/lib/incidents/support-hours-policy';

const schema = z
  .object({
    scopeKey: z.string().regex(/^(workspace|service:[A-Za-z0-9_-]+|integration:[A-Za-z0-9_-]+)$/),
    version: z.number().int().positive(),
    expectedVersion: z.number().int().nonnegative(),
    resource: z.enum(['classification', 'sla', 'support-hours']).default('classification'),
  })
  .strict();
export async function POST(request: NextRequest) {
  const auth = await authorizeResponsePolicyApi(request, 'write');
  if (!auth.ok) return jsonError(auth.message, auth.status);
  try {
    const input = schema.parse(await request.json());
    const actor = {
      actorId: auth.actor.id,
      capabilities: ['admin.manage'],
      source: 'RESTORE' as const,
    };
    if (input.resource === 'sla') {
      if (input.scopeKey.startsWith('integration:')) return jsonError('Invalid SLA scope', 400);
      const source = await prisma.incidentSlaPolicy.findUnique({
        where: { scopeKey_version: { scopeKey: input.scopeKey, version: input.version } },
        include: { rules: true },
      });
      if (!source?.sealedAt) return jsonError('Policy version not found', 404);
      const policy = await saveIncidentSlaPolicy(
        {
          scopeKey: input.scopeKey,
          expectedVersion: input.expectedVersion,
          inheritWorkspace: source.inheritWorkspace,
          baseAckTargetMs: source.baseAckTargetMs,
          baseResolveTargetMs: source.baseResolveTargetMs,
          rules: source.rules.map(rule => ({
            priority: rule.priority,
            ackTargetMs: rule.ackTargetMs,
            resolveTargetMs: rule.resolveTargetMs,
            label: rule.label,
          })),
        },
        actor
      );
      return jsonOk({ policy }, 201);
    }
    if (input.resource === 'support-hours') {
      if (input.scopeKey.startsWith('integration:'))
        return jsonError('Invalid support-hours scope', 400);
      const source = await prisma.responseSupportHoursPolicy.findUnique({
        where: { scopeKey_version: { scopeKey: input.scopeKey, version: input.version } },
        include: { windows: true, exceptions: true },
      });
      if (!source?.sealedAt) return jsonError('Policy version not found', 404);
      const policy = await saveSupportHoursPolicy(
        {
          scopeKey: input.scopeKey,
          expectedVersion: input.expectedVersion,
          timezone: source.timezone,
          inheritWorkspace: source.inheritWorkspace,
          mode: source.mode,
          windows: source.windows.map(({ dayOfWeek, startMinute, endMinute }) => ({
            dayOfWeek,
            startMinute,
            endMinute,
          })),
          exceptions: source.exceptions.map(
            ({ localDate, available, startMinute, endMinute, label }) => ({
              localDate,
              available,
              startMinute,
              endMinute,
              label,
            })
          ),
        },
        actor
      );
      return jsonOk({ policy }, 201);
    }
    const source = await prisma.incidentClassificationPolicy.findUnique({
      where: { scopeKey_version: { scopeKey: input.scopeKey, version: input.version } },
      include: { rules: true },
    });
    if (!source?.sealedAt) return jsonError('Policy version not found', 404);
    const policy = await saveClassificationPolicy(
      {
        scopeKey: input.scopeKey,
        expectedVersion: input.expectedVersion,
        derivePriorityFromUrgency: source.derivePriorityFromUrgency,
        priorityFallbackMode: source.priorityFallbackMode,
        rules: source.rules.map(rule => ({
          matchValue: rule.matchValue,
          priorityMode: rule.priorityMode,
          priority: rule.priority,
          urgencyMode: rule.urgencyMode,
          urgency: rule.urgency,
        })),
      },
      'RESTORE',
      { actorId: auth.actor.id, capabilities: ['admin.manage'], source: 'RESTORE' }
    );
    return jsonOk({ policy }, 201);
  } catch (error) {
    return responsePolicyError(error, 'Invalid restore request');
  }
}
