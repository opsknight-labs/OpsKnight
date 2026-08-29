import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { authenticateApiKey } from '@/lib/api-auth';
import { jsonError, jsonOk } from '@/lib/api-response';
import { resolveApiKeyActor } from '@/lib/authorization-actors';
import { serviceReadWhere } from '@/lib/authorization-filters';
import { AUTHORIZATION_ACTIONS, authorize } from '@/lib/authorization-policy';
import { authorizationDecisionError } from '@/lib/api-authorization-error';
import { AppError } from '@/lib/errors';

const LEGACY_UNAUTHORIZED_MESSAGE =
  'You do not have permission to perform this action. Please contact an administrator if you believe this is an error.';

function parseLimit(value: string | null) {
  const limit = Number(value);
  if (Number.isNaN(limit) || limit <= 0) return 50;
  return Math.min(limit, 200);
}

export async function GET(req: NextRequest) {
  try {
    const apiKey = await authenticateApiKey(req);
    if (!apiKey) {
      return jsonError(new AppError({ code: 'API_KEY_INVALID', userMessage: LEGACY_UNAUTHORIZED_MESSAGE }));
    }

    const { checkRateLimit } = await import('@/lib/rate-limit');
    const rate = await checkRateLimit(`api:${apiKey.id}:services:list`, 60, 60_000);
    if (!rate.allowed) {
      const retryAfter = Math.ceil((rate.resetAt - Date.now()) / 1000);
      return jsonError(
        new AppError({ code: 'RATE_LIMIT_EXCEEDED', userMessage: 'Rate limit exceeded.', details: { retryAfter } }),
        undefined,
        undefined,
        { 'Retry-After': String(retryAfter) }
      );
    }

    const actor = await resolveApiKeyActor(apiKey);
    if (!actor) {
      return jsonError(
        new AppError({
          code: 'API_KEY_USER_INVALID',
          userMessage: LEGACY_UNAUTHORIZED_MESSAGE,
          details: { apiKeyId: apiKey.id, userId: apiKey.userId },
        })
      );
    }

    const decision = authorize({ actor, action: AUTHORIZATION_ACTIONS.SERVICE_READ });
    if (!decision.allowed) {
      return jsonError(
        authorizationDecisionError(decision, { forbiddenMessage: 'Forbidden. Service access denied.' })
      );
    }

    const { searchParams } = new URL(req.url);
    const limit = parseLimit(searchParams.get('limit'));
    const services = await prisma.service.findMany({
      where: serviceReadWhere(actor),
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        teamId: true,
        escalationPolicyId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return jsonOk({ services });
  } catch (_error) {
    return jsonError('Internal Server Error', 500);
  }
}
