import type { NextRequest } from 'next/server';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { jsonError, jsonOk } from '@/lib/api-response';
import { authorizeResponsePolicyApi } from '@/lib/response-policy-api-auth';
import { saveClassificationPolicy } from '@/lib/incidents/classification-policy';

const schema = z
  .object({
    scopeKey: z.string().regex(/^(workspace|service:[A-Za-z0-9_-]+|integration:[A-Za-z0-9_-]+)$/),
    version: z.number().int().positive(),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();
export async function POST(request: NextRequest) {
  const auth = await authorizeResponsePolicyApi(request, 'write');
  if (!auth) return jsonError('Unauthorized', 401);
  try {
    const input = schema.parse(await request.json());
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
        rules: source.rules.map(rule => ({
          matchValue: rule.matchValue,
          priorityMode: rule.priorityMode,
          priority: rule.priority,
          urgencyMode: rule.urgencyMode,
          urgency: rule.urgency,
        })),
      },
      'RESTORE',
      auth.actor.id
    );
    return jsonOk({ policy }, 201);
  } catch {
    return jsonError('Invalid restore request', 400);
  }
}
