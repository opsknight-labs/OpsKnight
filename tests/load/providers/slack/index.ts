import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { executeProviderEmulatorStep } from '../shared';

export async function handleSlackEmulatorRequest(
  req: IncomingMessage,
  res: ServerResponse,
  rawBody: string
): Promise<void> {
  const url = req.url || '/';
  const isWebApi = url.includes('/api/chat.postMessage');
  const deliveryKey = crypto.createHash('sha256').update(`${url}:${rawBody}`).digest('hex');

  const decision = await executeProviderEmulatorStep('slack', {
    deliveryKey,
    recipient: url,
    successStatusCode: 200,
  });

  if (decision.hangTimeout) {
    req.socket.destroy();
    return;
  }

  const headers: Record<string, string> = {};
  if (decision.retryAfterSec) {
    headers['Retry-After'] = String(decision.retryAfterSec);
  }

  if (isWebApi) {
    headers['Content-Type'] = 'application/json';
    res.writeHead(decision.statusCode, headers);
    if (decision.allow) {
      res.end(
        JSON.stringify({
          ok: true,
          channel: 'C000LOADCERT',
          ts: `${Math.floor(Date.now() / 1000)}.000100`,
        })
      );
    } else {
      res.end(
        JSON.stringify({
          ok: false,
          error: decision.statusCode === 429 ? 'rate_limited' : decision.errorCode || 'internal_error',
        })
      );
    }
    return;
  }

  // Incoming Webhook path (/services/...) expects literal "ok" text on 200
  headers['Content-Type'] = 'text/plain; charset=utf-8';
  res.writeHead(decision.statusCode, headers);
  if (decision.allow) {
    res.end('ok');
  } else {
    res.end(decision.statusCode === 429 ? 'rate_limited' : decision.errorMessage || 'server_error');
  }
}
