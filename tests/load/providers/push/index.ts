import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { executeProviderEmulatorStep } from '../shared';

export async function handlePushEmulatorRequest(
  req: IncomingMessage,
  res: ServerResponse,
  rawBody: string
): Promise<void> {
  const url = req.url || '/push/unknown';
  const deliveryKey = crypto
    .createHash('sha256')
    .update(`${url}:${rawBody.slice(0, 128)}`)
    .digest('hex');

  const decision = await executeProviderEmulatorStep('push', {
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
    Location: `https://push.emulator.opsknight.internal/m/${crypto.randomUUID()}`,
  };
  if (decision.retryAfterSec) {
    headers['Retry-After'] = String(decision.retryAfterSec);
  }

  res.writeHead(decision.statusCode, headers);
  if (decision.allow) {
    res.end(JSON.stringify({ status: 'accepted' }));
  } else {
    res.end(
      JSON.stringify({
        error: decision.errorCode || 'push_delivery_failed',
        message: decision.errorMessage || 'Web Push delivery rejected',
      })
    );
  }
}
