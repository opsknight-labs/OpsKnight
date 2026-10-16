import { NextRequest } from 'next/server';
import {
  apiV2Created,
  apiV2Error,
  apiV2Success,
  authenticateV2Request,
  buildCursorWhere,
  createServiceAccount,
  enforceV2Authorization,
  enforceV2RateLimit,
  formatCursorPagination,
  idempotencyResponseHeaders,
  listServiceAccounts,
  parsePaginationParams,
  runV2IdempotentMutation,
  ServiceAccountCreateV2Schema,
} from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { AppError } from '@/lib/errors';
import type { AppRole } from '@/lib/authorization';
import { withV2Observability } from '@/lib/api-v2/observability';
import { SERVICE_ACCOUNT_DOMAIN } from '@/lib/service-account-identity';
import type { Prisma } from '@prisma/client';

export const GET = withV2Observability(async function GET(req: NextRequest) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'READ');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.SERVICE_ACCOUNT_READ);

    // Bounded and cursor-paginated; nested token lists are bounded inside listServiceAccounts.
    const { limit, cursor } = parsePaginationParams(new URL(req.url).searchParams);
    const accounts = await listServiceAccounts({
      where: {
        AND: [
          { email: { endsWith: `@${SERVICE_ACCOUNT_DOMAIN}`, mode: 'insensitive' } },
          buildCursorWhere(cursor) as Prisma.UserWhereInput,
        ],
      },
      take: limit + 1,
    });
    const page = formatCursorPagination(accounts, limit);
    return apiV2Success(page.data, { pagination: page.pagination, headers: rlHeaders });
  } catch (error) {
    return apiV2Error(error, req);
  }
});

export const POST = withV2Observability(async function POST(req: NextRequest) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'WRITE');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.SERVICE_ACCOUNT_MANAGE);

    const body = await req.json().catch(() => {
      throw new AppError({ code: 'INVALID_JSON', userMessage: 'Invalid JSON request body.' });
    });

    const validated = ServiceAccountCreateV2Schema.parse(body);

    const execution = await runV2IdempotentMutation(
      req,
      apiKey.id,
      'service-account:create',
      validated,
      tx =>
        createServiceAccount({
          name: validated.name,
          role: validated.role as AppRole,
          description: validated.description,
          teamIds: validated.teamIds,
          actorId: actor.id,
          tx,
        })
    );

    return apiV2Created(execution.value, {
      headers: { ...rlHeaders, ...idempotencyResponseHeaders(execution.replayed) },
    });
  } catch (error) {
    return apiV2Error(error, req);
  }
});
