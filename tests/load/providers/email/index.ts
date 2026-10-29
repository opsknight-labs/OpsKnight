import net from 'node:net';
import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { executeProviderEmulatorStep } from '../shared';

export function createSmtpEmulatorServer(): net.Server {
  return net.createServer(socket => {
    socket.setEncoding('utf8');
    let inDataMode = false;
    let buffer = '';
    let dataBuffer = '';
    let mailFrom = '';
    let rcptTo: string[] = [];

    const writeLine = (line: string) => {
      if (!socket.destroyed) {
        socket.write(`${line}\r\n`);
      }
    };

    writeLine('220 smtp.emulator.opsknight.internal ESMTP OpsKnightLoadEmulator Ready');

    socket.on('data', async (chunk: string) => {
      buffer += chunk;

      while (true) {
        if (inDataMode) {
          const endIdx = buffer.indexOf('\r\n.\r\n');
          const altEndIdx = buffer.indexOf('\n.\n');
          const matchIdx = endIdx !== -1 ? endIdx : altEndIdx;
          const delimiterLen = endIdx !== -1 ? 5 : 3;

          if (matchIdx === -1) break;

          dataBuffer += buffer.slice(0, matchIdx);
          buffer = buffer.slice(matchIdx + delimiterLen);
          inDataMode = false;

          // Extract subject or X-OpsKnight-Notification-Id for deterministic dedup tracking
          const subjectMatch = dataBuffer.match(/^Subject:\s*(.+)$/im);
          const messageIdMatch = dataBuffer.match(/^Message-ID:\s*(.+)$/im);
          const recipient = rcptTo[0] || 'unknown@loadtest.opsknight.internal';
          const deliveryKey =
            messageIdMatch?.[1]?.trim() ||
            crypto
              .createHash('sha256')
              .update(`${mailFrom}:${recipient}:${subjectMatch?.[1]?.trim() || dataBuffer.slice(0, 200)}`)
              .digest('hex');

          const decision = await executeProviderEmulatorStep('email', {
            deliveryKey,
            recipient,
            trafficClass: subjectMatch?.[1]?.includes('[Status]') ? 'BULK' : 'CRITICAL',
            successStatusCode: 250,
          });

          dataBuffer = '';
          mailFrom = '';
          rcptTo = [];

          if (decision.hangTimeout) {
            socket.destroy();
            return;
          }
          if (decision.allow) {
            writeLine(`250 2.0.0 OK queued as <${crypto.randomUUID()}@smtp.emulator.opsknight.internal>`);
          } else if (decision.statusCode === 429) {
            writeLine('421 4.7.0 Too many requests, rate limit exceeded');
          } else if (decision.statusCode >= 500) {
            writeLine('451 4.3.0 Temporary backend failure');
          } else {
            writeLine('550 5.1.1 Mailbox unavailable or rejected');
          }
          continue;
        }

        const lineEnd = buffer.indexOf('\n');
        if (lineEnd === -1) break;
        const line = buffer.slice(0, lineEnd).replace(/\r$/, '');
        buffer = buffer.slice(lineEnd + 1);

        const upper = line.toUpperCase();
        if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {
          writeLine('250-smtp.emulator.opsknight.internal');
          writeLine('250-PIPELINING');
          writeLine('250-8BITMIME');
          writeLine('250 AUTH PLAIN LOGIN');
        } else if (upper.startsWith('AUTH PLAIN') || upper.startsWith('AUTH LOGIN')) {
          writeLine('235 2.7.0 Authentication successful');
        } else if (upper.startsWith('MAIL FROM:')) {
          mailFrom = line.slice(10).trim();
          writeLine('250 2.1.0 OK');
        } else if (upper.startsWith('RCPT TO:')) {
          rcptTo.push(line.slice(8).trim());
          writeLine('250 2.1.5 OK');
        } else if (upper === 'DATA') {
          inDataMode = true;
          dataBuffer = '';
          writeLine('354 Start mail input; end with <CRLF>.<CRLF>');
        } else if (upper === 'RSET') {
          mailFrom = '';
          rcptTo = [];
          dataBuffer = '';
          writeLine('250 2.0.0 OK');
        } else if (upper === 'NOOP') {
          writeLine('250 2.0.0 OK');
        } else if (upper === 'QUIT') {
          writeLine('221 2.0.0 Bye');
          socket.end();
          return;
        } else {
          writeLine('250 2.0.0 OK');
        }
      }
    });

    socket.on('error', () => {
      socket.destroy();
    });
  });
}

export async function handleHttpEmailRequest(
  req: IncomingMessage,
  res: ServerResponse,
  rawBody: string
): Promise<void> {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(rawBody || '{}') as Record<string, unknown>;
  } catch {
    // ignore
  }
  const idempotencyKey =
    (req.headers['idempotency-key'] as string | undefined) ||
    crypto.createHash('sha256').update(rawBody).digest('hex');
  const to = String(parsed.to || 'subscriber@loadtest.opsknight.internal');

  const decision = await executeProviderEmulatorStep('email', {
    deliveryKey: idempotencyKey,
    recipient: to,
    successStatusCode: 200,
  });

  if (decision.hangTimeout) {
    req.socket.destroy();
    return;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-message-id': `em_${crypto.randomUUID()}`,
  };
  if (decision.retryAfterSec) {
    headers['Retry-After'] = String(decision.retryAfterSec);
  }

  res.writeHead(decision.statusCode, headers);
  if (decision.allow) {
    res.end(JSON.stringify({ id: headers['x-message-id'], status: 'sent' }));
  } else {
    res.end(
      JSON.stringify({
        name: decision.errorCode || 'provider_error',
        message: decision.errorMessage || 'Email provider error',
        statusCode: decision.statusCode,
      })
    );
  }
}
