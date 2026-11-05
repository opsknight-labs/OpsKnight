import { logAudit } from '@/lib/audit';
import { withMcpDatabase } from '@/lib/database-workload';
import OAuth2Server from '@node-oauth/oauth2-server';
import { Prisma } from '@prisma/client';
import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { acquireMcpOAuthSlot, admitMcpOAuthRequest } from '@/lib/mcp/auth/admission';
import { mcpOAuthServer } from '@/lib/mcp/auth/oauth-model';
import { mcpResource, withMcpRuntime } from '@/lib/mcp/auth/config';
import { assertMcpHost, mcpHttpError, uniqueQuery } from '@/lib/mcp/auth/http';
import { McpBoundaryError, requireMcp } from '@/lib/mcp/core/errors';
import { readBoundedMcpText } from '@/lib/mcp/core/body';

export const runtime = 'nodejs';
const schema = z
  .object({
    grant_type: z.enum(['authorization_code', 'refresh_token']),
    client_id: z.string().max(256),
    code: z.string().max(256).optional(),
    code_verifier: z
      .string()
      .regex(/^[A-Za-z0-9._~-]{43,128}$/)
      .optional(),
    redirect_uri: z.string().url().max(2048).optional(),
    refresh_token: z.string().max(256).optional(),
    scope: z.string().max(2048).optional(),
    resource: z.string().url().optional(),
  })
  // RFC 6749 section 3.2: unrecognized parameters are ignored, never refused.
  .strip();

export function POST(request: Request) {
  return withMcpDatabase(() => withMcpRuntime(() => handlePost(request)));
}

async function handlePost(request: Request) {
  let reused: string | undefined;
  let release: (() => void) | undefined;
  try {
    assertMcpHost(request);
    release = await acquireMcpOAuthSlot('token');
    const policy = await prisma.mcpPolicy.findUnique({ where: { id: 'default' } });
    requireMcp(policy?.enabled, 'MCP_DISABLED', 503);
    await admitMcpOAuthRequest(request, 'token');
    requireMcp(
      request.headers.get('content-type')?.split(';')[0] === 'application/x-www-form-urlencoded',
      'invalid_request',
      415
    );
    const form = await readBoundedMcpText(request, 8192);
    const body = schema.parse(uniqueQuery(new URLSearchParams(form)));
    requireMcp(!body.resource || body.resource === mcpResource(), 'invalid_target');
    requireMcp(
      body.grant_type !== 'authorization_code' ||
        (body.code && body.code_verifier && body.redirect_uri),
      'invalid_request'
    );
    requireMcp(body.grant_type !== 'refresh_token' || body.refresh_token, 'invalid_request');
    let response = new OAuth2Server.Response();
    const exchange = async () => {
      // Each attempt starts clean: only a genuine reuse in the attempt that failed revokes.
      reused = undefined;
      response = new OAuth2Server.Response();
      await prisma.$transaction(
        async tx => {
          await mcpOAuthServer(tx, id => {
            reused = id;
          }).token(
            new OAuth2Server.Request({
              method: 'POST',
              headers: {
                'content-type': 'application/x-www-form-urlencoded',
                'content-length': String(Buffer.byteLength(form)),
              },
              query: {},
              body,
            }),
            response,
            {
              requireClientAuthentication: { authorization_code: false, refresh_token: false },
              requirePKCE: true,
              alwaysIssueNewRefreshToken: true,
            }
          );
        },
        { isolationLevel: 'Serializable', timeout: 5000 }
      );
    };
    try {
      await exchange();
    } catch (error) {
      // A serialization conflict (for example two refreshes at once) is retried once.
      if (!isSerializationConflict(innerError(error))) throw error;
      await exchange();
    }
    return Response.json(response.body as unknown, {
      status: response.status ?? 200,
      headers: { ...response.headers, 'Cache-Control': 'no-store', Pragma: 'no-cache' },
    });
  } catch (error) {
    if (reused)
      await prisma.$transaction(async tx => {
        await tx.mcpGrant.update({ where: { id: reused }, data: { revokedAt: new Date() } });
        await logAudit(
          {
            source: 'AUTH',
            action: 'mcp.grant.reuse_detected',
            entityType: 'SYSTEM_CONFIG',
            entityId: reused,
          },
          tx
        );
      });
    return tokenErrorResponse(error);
  } finally {
    release?.();
  }
}

const OAUTH_ERRORS = new Set([
  'invalid_request',
  'invalid_client',
  'invalid_grant',
  'unauthorized_client',
  'unsupported_grant_type',
  'invalid_scope',
  'invalid_target',
]);
// Conflicts, pool exhaustion, an unreachable database and transaction timeouts are retryable.
const TRANSIENT_CODES = new Set(['P2034', 'P2024', 'P2028', 'P1001', 'P1002', 'P1008', 'P1017']);

/** The model's own error; the library wraps anything it did not raise as a server_error. */
function innerError(error: unknown): unknown {
  return error instanceof OAuth2Server.OAuthError && error.inner ? error.inner : error;
}
function databaseCode(error: unknown) {
  if (!error || typeof error !== 'object') return null;
  const meta = 'meta' in error && error.meta && typeof error.meta === 'object' ? error.meta : {};
  const code = 'code' in error ? error.code : 'errorCode' in error ? error.errorCode : undefined;
  const state = 'code' in meta ? meta.code : undefined;
  return { code: code == null ? null : String(code), state: state == null ? null : String(state) };
}
function isSerializationConflict(error: unknown) {
  const found = databaseCode(error);
  return found?.code === 'P2034' || found?.state === '40001' || found?.state === '40P01';
}
function isTransientDatabaseError(error: unknown) {
  if (error instanceof Prisma.PrismaClientInitializationError) return true;
  const found = databaseCode(error);
  return (
    isSerializationConflict(error) ||
    (found?.code != null && TRANSIENT_CODES.has(found.code)) ||
    (error instanceof Error && /transaction.*(timed? ?out|expired|closed)/i.test(error.message))
  );
}

/**
 * A refresh that fails for a passing reason must never look like a dead credential: clients
 * discard their tokens on invalid_grant and send the person back through sign-in.
 */
function tokenErrorResponse(error: unknown) {
  const headers = { 'Cache-Control': 'no-store' };
  const inner = innerError(error);
  if (isTransientDatabaseError(inner))
    return Response.json(
      {
        error: 'temporarily_unavailable',
        error_description: 'OpsKnight is briefly busy. Retry shortly; your sign-in is still valid.',
      },
      { status: 503, headers: { ...headers, 'Retry-After': '2' } }
    );
  // A model check keeps its own OAuth code (invalid_scope stays invalid_scope).
  if (inner instanceof McpBoundaryError && inner !== error && OAUTH_ERRORS.has(inner.code))
    return Response.json(
      { error: inner.code },
      { status: inner.code === 'invalid_client' ? 401 : 400, headers }
    );
  if (inner instanceof McpBoundaryError) return mcpHttpError(inner);
  if (error instanceof z.ZodError)
    return Response.json({ error: 'invalid_request' }, { status: 400, headers });
  if (error instanceof OAuth2Server.ServerError)
    return Response.json({ error: 'server_error' }, { status: 500, headers });
  if (error instanceof OAuth2Server.OAuthError)
    return Response.json(
      { error: OAUTH_ERRORS.has(error.name) ? error.name : 'invalid_grant' },
      { status: error.name === 'invalid_client' ? 401 : 400, headers }
    );
  return mcpHttpError(error);
}
