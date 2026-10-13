import { NextRequest } from 'next/server';
import {
  apiV2Created,
  apiV2Error,
  apiV2Success,
  authenticateV2Request,
  createServiceAccount,
  enforceV2Authorization,
  enforceV2RateLimit,
  listServiceAccounts,
  ServiceAccountCreateV2Schema,
} from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { AppError } from '@/lib/errors';
import type { AppRole } from '@/lib/authorization';

export async function GET(req: NextRequest) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'READ');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.SERVICE_ACCOUNT_READ);

    const accounts = await listServiceAccounts();
    return apiV2Success(accounts, { headers: rlHeaders });
  } catch (error) {
    return apiV2Error(error, req);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'WRITE');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.SERVICE_ACCOUNT_MANAGE);

    const body = await req.json().catch(() => {
      throw new AppError({ code: 'INVALID_JSON', status: 400, userMessage: 'Invalid JSON request body.' });
    });

    const validated = ServiceAccountCreateV2Schema.parse(body);

    const account = await createServiceAccount({
      name: validated.name,
      role: validated.role as AppRole,
      description: validated.description,
      teamIds: validated.teamIds,
      actorId: actor.id,
    });

    return apiV2Created(account, { headers: rlHeaders });
  } catch (error) {
    return apiV2Error(error, req);
  }
}
