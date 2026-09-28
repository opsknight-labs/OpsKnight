import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { executeProviderEmulatorStep } from '../shared';

export async function handleWebhookEmulatorRequest(
  req: IncomingMessage,
  res: ServerResponse,
  rawBody: string
): Promise<void> {
  const url = req.url || '/webhook/default';
  const deliveryIdHeader = req.headers['x-opsknight-delivery-id'];
  const deliveryKey =
    (typeof deliveryIdHeader === 'string' && deliveryIdHeader.trim()) ||
    crypto.createHash('sha256').update(`${url}:${rawBody}`).digest('hex');

  const decision = await executeProviderEmulatorStep('webhook', {
    deliveryKey,
    recipient: url,
    trafficClass: url.includes('status-webhook') ? 'PUBLIC_INCIDENT' : 'TRANSACTIONAL',
    successStatusCode: 200,
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
    res.end(
      JSON.stringify({
        received: true,
        deliveryId: deliveryKey,
        timestamp: new Date().toISOString(),
      })
    );
  } else {
    res.end(
      JSON.stringify({
        received: false,
        error: decision.errorCode || 'webhook_rejected',
        message: decision.errorMessage || 'Webhook endpoint failure',
      })
    );
  }
}
