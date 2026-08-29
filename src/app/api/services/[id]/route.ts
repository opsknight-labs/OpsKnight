import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { authenticateApiKey } from '@/lib/api-auth';
import { jsonError, jsonOk } from '@/lib/api-response';
import { resolveApiKeyActor } from '@/lib/authorization-actors';
import { serviceReadWhere } from '@/lib/authorization-filters';
import { AUTHORIZATION_ACTIONS, authorize } from '@/lib/authorization-policy';
import { authorizationDecisionError } from '@/lib/api-authorization-error';
import { AppError, isAppError } from '@/lib/errors';

const LEGACY_UNAUTHORIZED_MESSAGE =
  'You do not have permission to perform this action. Please contact an administrator if you believe this is an error.';
const LEGACY_NOT_FOUND_MESSAGE =
  'The requested item could not be found. It may have been deleted or you may not have access to it.';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const apiKey = await authenticateApiKey(req);
    if (!apiKey) {
      return jsonError(
        new AppError({ code: 'API_KEY_INVALID', userMessage: LEGACY_UNAUTHORIZED_MESSAGE })
      );
    }

    const { checkRateLimit } = await import('@/lib/rate-limit');
    const rate = await checkRateLimit(`api:${apiKey.id}:services:get`, 60, 60_000);
    if (!rate.allowed) {
      const retryAfter = Math.ceil((rate.resetAt - Date.now()) / 1000);
      return jsonError(
        new AppError({
          code: 'RATE_LIMIT_EXCEEDED',
          userMessage: 'Rate limit exceeded.',
          details: { retryAfter },
        }),
        undefined,
        undefined,
        { 'Retry-After': String(retryAfter) }
      );
    }

    const { id } = await params;
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
        authorizationDecisionError(decision, {
          forbiddenMessage: 'Forbidden. Service access denied.',
        })
      );
    }

    const accessFilter = serviceReadWhere(actor);
    const service = await prisma.service.findFirst({
      where: { id, ...accessFilter },
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

    if (!service) {
      return jsonError(
        new AppError({
          code: 'SERVICE_NOT_FOUND',
          userMessage: LEGACY_NOT_FOUND_MESSAGE,
          details: { serviceId: id },
        })
      );
    }

    return jsonOk({ service });
  } catch (error) {
    if (isAppError(error)) return jsonError(error);
    return jsonError('Internal Server Error', 500);
  }
}
