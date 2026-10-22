import { AsyncLocalStorage } from 'node:async_hooks';
import { recordRequest } from '../observability/metrics';
import { scimError } from '@/lib/scim';
import { AppError } from '@/lib/errors';
import { ScimFailure } from './validation';

export function json(body: unknown, status = 200, location?: string) {
  return Response.json(body, {
    status,
    headers: {
      'Content-Type': 'application/scim+json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...(location ? { Location: location } : {}),
    },
  });
}
async function respond(operation: () => Promise<Response>): Promise<Response> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ScimFailure) {
      const response = scimError(error.status, error.message, error.scimType);
      if (error.status === 429 || error.status === 503) response.headers.set('Retry-After', '60');
      return response;
    }
    if (error instanceof AppError && error.exposure === 'public')
      return scimError(error.status, error.userMessage);
    if (error instanceof Error && error.message === 'USER_SECURITY_CHANGED')
      return scimError(409, 'User security state changed. Retry the operation.');
    const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
    if (code === 'P2002')
      return scimError(409, 'A resource with this identifier already exists.', 'uniqueness');
    // Never expose database messages, SQL, payloads or connection details.
    const response = scimError(503, 'Provisioning is temporarily unavailable. Retry the request.');
    response.headers.set('Retry-After', '60');
    return response;
  }
}

const context = new AsyncLocalStorage<{ requestId: string }>();
export function scimRequestId() {
  return context.getStore()?.requestId ?? crypto.randomUUID();
}
export async function handle(
  operation: () => Promise<Response>,
  request?: Request
): Promise<Response> {
  const requestId = crypto.randomUUID();
  const started = performance.now();
  const response = await context.run({ requestId }, () => respond(operation));
  response.headers.set('X-Request-ID', requestId);
  const path = request ? new URL(request.url).pathname : '';
  recordRequest(
    request?.method ?? 'UNKNOWN',
    path.includes('/Groups') ? 'Groups' : path.includes('/Users') ? 'Users' : 'Discovery',
    response.status,
    performance.now() - started
  );
  return response;
}
