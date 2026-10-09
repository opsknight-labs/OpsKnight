import 'server-only';

import { jsonError } from '@/lib/api-response';
import { ZodError } from 'zod';
import { authenticateAgentRequest } from './agent-auth';
import {
  RunbookPreExecutionFenceError,
  RunbookAgentLeaseExpiredError,
  RunbookAgentLeaseTokenMismatchError,
  RunbookAgentRevokedError,
  RunbookAgentNotFoundError,
  RunbookError,
} from './errors';

export class RunbookPayloadTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Payload exceeds maximum allowed size of ${maxBytes} bytes.`);
    this.name = 'RunbookPayloadTooLargeError';
  }
}

export async function readBoundedRequestBody(request: Request, maxBytes: number): Promise<string> {
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null && contentLength !== undefined) {
    const parsedLength = parseInt(contentLength, 10);
    if (!Number.isNaN(parsedLength) && parsedLength > maxBytes) {
      throw new RunbookPayloadTooLargeError(maxBytes);
    }
  }

  if (!request.body) {
    return '';
  }

  if (typeof request.body.getReader !== 'function') {
    const text = await request.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw new RunbookPayloadTooLargeError(maxBytes);
    }
    return text;
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel('Request payload exceeds limit');
        throw new RunbookPayloadTooLargeError(maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(combined);
}

export async function authenticatedAgentJson(request: Request, maxBytes: number = 64 * 1024) {
  const rawBody = await readBoundedRequestBody(request, maxBytes);
  const agent = await authenticateAgentRequest(request, rawBody);
  let json: unknown = {};
  if (rawBody) {
    try {
      json = JSON.parse(rawBody);
    } catch {
      throw new Error('Request body must be valid JSON.');
    }
  }
  return { agent, json };
}

export function agentApiError(error: unknown) {
  if (
    error instanceof RunbookPayloadTooLargeError ||
    (error instanceof Error &&
      (error.name === 'RunbookPayloadTooLargeError' ||
        error.message.startsWith('Payload exceeds maximum allowed size')))
  ) {
    return jsonError('Payload too large.', 413);
  }
  if (error instanceof RunbookAgentRevokedError) return jsonError('Agent has been revoked.', 403);
  if (
    error instanceof RunbookPreExecutionFenceError ||
    error instanceof RunbookAgentLeaseExpiredError ||
    error instanceof RunbookAgentLeaseTokenMismatchError
  ) {
    return jsonError('Execution result or lease is outside its accepted fence.', 409);
  }
  if (error instanceof RunbookAgentNotFoundError) return jsonError('Agent not found.', 404);
  if (error instanceof ZodError || error instanceof RunbookError) return jsonError(error, 400);
  const message = error instanceof Error ? error.message : 'Agent request failed.';
  const authenticationErrors = new Set([
    'Missing agent authentication headers.',
    'Agent request timestamp is outside the allowed window.',
    'Agent has not completed enrollment.',
    'Agent request signature is invalid.',
    'Agent request replay detected.',
    'Enrollment token is invalid, expired, or already consumed.',
    'Enrollment token has already been consumed.',
  ]);
  if (authenticationErrors.has(message)) return jsonError('Agent authentication failed.', 401);
  if (
    message.startsWith('Artifact quota exceeded') ||
    [
      'Request body must be valid JSON.',
      'A PEM public signing key is required.',
      'Compressed artifact must be between 1 byte and 1 MiB.',
      'Artifact checksum does not match.',
    ].includes(message)
  )
    return jsonError(message, 400);
  // Infrastructure errors must remain retryable; never quarantine results on a DB outage.
  return jsonError('Agent API temporarily unavailable.', 500);
}
