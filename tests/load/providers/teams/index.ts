import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { executeProviderEmulatorStep } from '../shared';

export async function handleTeamsEmulatorRequest(
  req: IncomingMessage,
  res: ServerResponse,
  rawBody: string
): Promise<void> {
  const url = req.url || '/';

  // Microsoft Identity OAuth2 token endpoint
  if (url.includes('/oauth2/v2.0/token')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        token_type: 'Bearer',
        expires_in: 3600,
        ext_expires_in: 3600,
        access_token: 'lt_teams_emulator_access_token_valid',
      })
    );
    return;
  }

  const deliveryKey = crypto.createHash('sha256').update(`${url}:${rawBody}`).digest('hex');
  const decision = await executeProviderEmulatorStep('teams', {
    deliveryKey,
    recipient: url,
    successStatusCode: 201,
  });

  if (decision.hangTimeout) {
    req.socket.destroy();
    return;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (decision.retryAfterSec) {
    headers['Retry-After'] = String(decision.retryAfterSec);
  }

  res.writeHead(decision.statusCode, headers);
  if (decision.allow) {
    const id = `teams-msg-${crypto.randomUUID()}`;
    res.end(
      JSON.stringify({
        id,
        activityId: id,
      })
    );
  } else {
    res.end(
      JSON.stringify({
        error: {
          code: decision.errorCode || 'ServiceError',
          message: decision.errorMessage || 'Microsoft Teams connector error',
        },
      })
    );
  }
}
