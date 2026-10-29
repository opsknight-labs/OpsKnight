import { z } from 'zod/v3';
import { mcpOrigin } from './config';
import { requireMcp, McpBoundaryError } from '../core/errors';

export function assertMcpHost(request: Request, browserWrite = false) {
  const origin = mcpOrigin();
  const host = request.headers.get('host');
  // Next's standalone server builds request.url from its internal listener.
  // Require ingress to preserve the pinned public Host; forwarded headers never
  // establish authority here. Fetch Requests without Host use their own URL.
  requireMcp(
    host ? host === new URL(origin).host : new URL(request.url).origin === origin,
    'MCP_INVALID_HOST',
    403
  );
  const supplied = request.headers.get('origin');
  requireMcp((!browserWrite && !supplied) || supplied === origin, 'MCP_INVALID_ORIGIN', 403);
}

export function mcpHttpError(error: unknown) {
  const status =
    error instanceof McpBoundaryError
      ? error.status
      : error instanceof z.ZodError || error instanceof SyntaxError
        ? 400
        : 503;
  const code =
    error instanceof McpBoundaryError
      ? error.code
      : status === 400
        ? 'invalid_request'
        : 'MCP_UNAVAILABLE';
  return Response.json(
    { error: code },
    {
      status,
      headers: {
        'Cache-Control': 'private, no-store',
        ...(status === 429 || status === 503 ? { 'Retry-After': '5' } : {}),
        ...(status === 401
          ? {
              'WWW-Authenticate': `Bearer resource_metadata="${mcpOrigin()}/.well-known/oauth-protected-resource/mcp"`,
            }
          : {}),
      },
    }
  );
}

export const authorizationQuerySchema = z
  .object({
    client_id: z.string().min(1).max(256),
    redirect_uri: z.string().url().max(2048),
    response_type: z.literal('code'),
    scope: z.string().min(1).max(2048).optional(),
    state: z.string().min(16).max(512),
    code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    code_challenge_method: z.literal('S256'),
    // RFC 8707 is optional here: the audience is always this server's MCP URL.
    resource: z.string().url().optional(),
  })
  .strict();

export function uniqueQuery(search: URLSearchParams) {
  requireMcp(
    [...search.keys()].every(key => search.getAll(key).length === 1),
    'MCP_DUPLICATE_PARAMETER'
  );
  return Object.fromEntries(search);
}
