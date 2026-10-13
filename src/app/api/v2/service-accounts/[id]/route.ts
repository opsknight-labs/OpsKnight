import { NextRequest } from 'next/server';
import {
  apiV2Error,
  apiV2Success,
  authenticateV2Request,
  deleteServiceAccount,
  enforceV2Authorization,
  enforceV2RateLimit,
  getServiceAccount,
} from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'READ');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.SERVICE_ACCOUNT_READ);

    const { id } = await params;
    const account = await getServiceAccount(id);

    return apiV2Success(account, { headers: rlHeaders });
  } catch (error) {
    return apiV2Error(error, req);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'WRITE');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.SERVICE_ACCOUNT_MANAGE);

    const { id } = await params;
    const result = await deleteServiceAccount(id, actor.id);

    return apiV2Success(result, { headers: rlHeaders });
  } catch (error) {
    return apiV2Error(error, req);
  }
}
