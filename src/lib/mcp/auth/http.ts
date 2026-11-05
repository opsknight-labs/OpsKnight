import { z } from 'zod/v3';
import { mcpOrigin } from './config';
import { requireMcp, McpBoundaryError } from '../core/errors';
import { friendlyMcpError } from './friendly-error';

/**
 * `allowedOrigin` is a foreign browser Origin an administrator allowed exactly (cors.ts); it is
 * honoured only for bearer and public-client endpoints, never for a browser write.
 */
export function assertMcpHost(
  request: Request,
  browserWrite = false,
  allowedOrigin: string | null = null
) {
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
  requireMcp(
    (!browserWrite && (!supplied || (allowedOrigin !== null && supplied === allowedOrigin))) ||
      supplied === origin,
    'MCP_INVALID_ORIGIN',
    403
  );
}

/** Fixed challenge text: RFC 6750 section 3 forbids quotes and backslashes in it. */
const challengeText = (code: string) =>
  code === 'MCP_ACCESS_CHANGED'
    ? 'Your access changed; reconnect'
    : 'The access token is missing, expired or revoked';

/** Only RFC 6749 §3.3 scope-token characters may sit inside the quoted `scope` field. */
const SCOPE_TOKEN = /^[\x21\x23-\x5b\x5d-\x7e]+$/;
const safeScope = (value: string) => value.split(' ').every(token => SCOPE_TOKEN.test(token));

function bearerChallenge(error: unknown, code: string) {
  const resource = `resource_metadata="${mcpOrigin()}/.well-known/oauth-protected-resource/mcp"`;
  const scope =
    error instanceof McpBoundaryError && error.challengeScope && safeScope(error.challengeScope)
      ? `, scope="${error.challengeScope}"`
      : '';
  // RFC 6750 section 3.1: a request with no credential gets no error code, so clients start
  // sign-in instead of trying a refresh first. invalid_token tells them to refresh or sign in again.
  if (code === 'MCP_TOKEN_REQUIRED') return `Bearer ${resource}${scope}`;
  return `Bearer error="invalid_token", error_description="${challengeText(code)}", ${resource}${scope}`;
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
  // Clients surface error_description to the person using them; keep it actionable.
  const described = friendlyMcpError(code);
  return Response.json(
    { error: code, ...(described.known ? { error_description: described.body } : {}) },
    {
      status,
      headers: {
        'Cache-Control': 'private, no-store',
        // The real wait when the error knows it (a quota window, a busy queue); else a short one.
        ...(status === 429 || status === 503
          ? {
              'Retry-After': String(
                (error instanceof McpBoundaryError && error.retryAfterSeconds) || 5
              ),
            }
          : {}),
        ...(status === 401 ? { 'WWW-Authenticate': bearerChallenge(error, code) } : {}),
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
    // Optional in OAuth 2.1: PKCE (required below) is what protects the code.
    state: z.string().min(1).max(512).optional(),
    code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    code_challenge_method: z.literal('S256'),
    // RFC 8707 is optional here: the audience is always this server's MCP URL.
    resource: z.string().url().optional(),
  })
  // RFC 6749 section 3.1: unrecognized parameters (prompt, login_hint, nonce, extensions) are
  // ignored, never refused. Duplicates are still refused by uniqueQuery.
  .strip();

export function uniqueQuery(search: URLSearchParams) {
  requireMcp(
    [...search.keys()].every(key => search.getAll(key).length === 1),
    'MCP_DUPLICATE_PARAMETER'
  );
  return Object.fromEntries(search);
}
