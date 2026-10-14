import { NextRequest } from 'next/server';
import {
  apiV2Created,
  apiV2Error,
  authenticateV2Request,
  enforceV2Authorization,
  enforceV2RateLimit,
  issueServiceAccountToken,
  ServiceAccountTokenIssueV2Schema,
} from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { AppError } from '@/lib/errors';
import { withV2Observability } from '@/lib/api-v2/observability';

export const POST = withV2Observability(async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'WRITE');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.SERVICE_ACCOUNT_MANAGE);

    const { id } = await params;
    const body = await req.json().catch(() => {
      throw new AppError({ code: 'INVALID_JSON', userMessage: 'Invalid JSON request body.' });
    });

    const validated = ServiceAccountTokenIssueV2Schema.parse(body);

    const result = await issueServiceAccountToken({
      serviceAccountId: id,
      name: validated.name,
      scopes: validated.scopes,
      expiresInDays: validated.expiresInDays,
      neverExpires: validated.neverExpires,
      actorId: actor.id,
    });

    return apiV2Created(result, { headers: rlHeaders });
  } catch (error) {
    return apiV2Error(error, req);
  }
});
