import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { executeProviderEmulatorStep } from '../shared';

export async function handleSmsEmulatorRequest(
  req: IncomingMessage,
  res: ServerResponse,
  rawBody: string
): Promise<void> {
  const params = new URLSearchParams(rawBody);
  const to = params.get('To') || 'unknown';
  const body = params.get('Body') || '';
  const statusCallback = params.get('StatusCallback') || '';
  const callbackNotificationId = statusCallback.includes('notificationId=')
    ? decodeURIComponent(statusCallback.split('notificationId=')[1]?.split('&')[0] || '')
    : '';

  const deliveryKey =
    callbackNotificationId ||
    crypto.createHash('sha256').update(`${to}:${body}`).digest('hex');

  const decision = await executeProviderEmulatorStep('sms', {
    deliveryKey,
    recipient: to,
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
    const sid = `SM${crypto.randomBytes(16).toString('hex')}`;
    res.end(
      JSON.stringify({
        sid,
        status: 'queued',
        to,
        from: params.get('From') || '+15550000000',
        body,
      })
    );
  } else {
    res.end(
      JSON.stringify({
        code: decision.statusCode === 429 ? 20429 : 20003,
        message: decision.errorMessage || 'Twilio API error',
        status: decision.statusCode,
      })
    );
  }
}
