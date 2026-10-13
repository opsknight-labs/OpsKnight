import { NextRequest } from 'next/server';
import {
  apiV2Error,
  apiV2Success,
  authenticateV2Request,
  enforceV2Authorization,
  enforceV2RateLimit,
  revokeServiceAccountToken,
} from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; tokenId: string }> }
) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'WRITE');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.SERVICE_ACCOUNT_MANAGE);

    const { id, tokenId } = await params;
    const result = await revokeServiceAccountToken(id, tokenId, actor.id);

    return apiV2Success(result, { headers: rlHeaders });
  } catch (error) {
    return apiV2Error(error, req);
  }
}
