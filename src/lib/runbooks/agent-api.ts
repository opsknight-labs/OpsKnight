import 'server-only';

import { jsonError } from '@/lib/api-response';
import { AppError, isAppErrorCode } from '@/lib/errors';
import { ZodError } from 'zod/v3';
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
    if (contentLength === null || contentLength === undefined) {
      throw new RunbookPayloadTooLargeError(maxBytes);
    }
    const parsedLength = parseInt(contentLength, 10);
    if (Number.isNaN(parsedLength) || parsedLength < 0 || parsedLength > maxBytes) {
      throw new RunbookPayloadTooLargeError(maxBytes);
    }
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

function getErrorCode(error: unknown): string | undefined {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
  ) {
    return (error as { code: string }).code;
  }
  return undefined;
}

export function agentApiError(error: unknown) {
  const code = getErrorCode(error);
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : 'Agent request failed.';

  if (
    error instanceof RunbookPayloadTooLargeError ||
    name === 'RunbookPayloadTooLargeError' ||
    message.startsWith('Payload exceeds maximum allowed size')
  ) {
    return jsonError('Payload too large.', 413);
  }

  if (
    code === 'RUNBOOK_AGENT_REVOKED' ||
    error instanceof RunbookAgentRevokedError ||
    name === 'RunbookAgentRevokedError'
  ) {
    return jsonError('Agent has been revoked.', 403);
  }

  if (
    code === 'RUNBOOK_PRE_EXECUTION_FENCE_FAILED' ||
    code === 'RUNBOOK_AGENT_LEASE_EXPIRED' ||
    code === 'RUNBOOK_AGENT_LEASE_TOKEN_MISMATCH' ||
    code === 'RUNBOOK_APPROVAL_PLAN_CHANGED' ||
    error instanceof RunbookPreExecutionFenceError ||
    error instanceof RunbookAgentLeaseExpiredError ||
    error instanceof RunbookAgentLeaseTokenMismatchError ||
    [
      'RunbookPreExecutionFenceError',
      'RunbookAgentLeaseExpiredError',
      'RunbookAgentLeaseTokenMismatchError',
      'RunbookApprovalPlanChangedError',
    ].includes(name)
  ) {
    return jsonError('Execution result or lease is outside its accepted fence.', 409);
  }

  if (
    code === 'RUNBOOK_AGENT_NOT_FOUND' ||
    error instanceof RunbookAgentNotFoundError ||
    name === 'RunbookAgentNotFoundError'
  ) {
    return jsonError('Agent not found.', 404);
  }

  if (
    error instanceof ZodError ||
    name === 'ZodError' ||
    (error &&
      typeof error === 'object' &&
      'issues' in error &&
      Array.isArray((error as { issues?: unknown }).issues)) ||
    error instanceof RunbookError ||
    (code !== undefined && code.startsWith('RUNBOOK_'))
  ) {
    if (code && isAppErrorCode(code)) {
      return jsonError(
        new AppError({
          code,
          userMessage: message,
        }),
        400
      );
    }
    return jsonError(message || 'Invalid runbook request.', 400);
  }

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
      'Compressed artifact must be between 1 byte and 10 MiB.',
      'Artifact checksum does not match.',
      'Artifact must be valid gzip with at most 10 MiB of decoded text.',
      'Artifact must contain valid UTF-8 text.',
    ].includes(message)
  ) {
    return jsonError(message, 400);
  }

  // Infrastructure errors must remain retryable; never quarantine results on a DB outage.
  return jsonError('Agent API temporarily unavailable.', 500);
}
