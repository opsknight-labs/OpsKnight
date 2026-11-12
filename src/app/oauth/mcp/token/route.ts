import { logAudit } from '@/lib/audit';
import { withMcpDatabase } from '@/lib/database-workload';
import OAuth2Server from '@node-oauth/oauth2-server';
import { Prisma, type McpPolicy } from '@prisma/client';
import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { acquireMcpOAuthSlot, admitMcpOAuthRequest } from '@/lib/mcp/auth/admission';
import { mcpOAuthServer } from '@/lib/mcp/auth/oauth-model';
import { mcpResource, withMcpRuntime } from '@/lib/mcp/auth/config';
import { browserPreflight, withBrowserCors } from '@/lib/mcp/auth/cors';
import { assertMcpHost, mcpHttpError, uniqueQuery } from '@/lib/mcp/auth/http';
import { McpBoundaryError, requireMcp } from '@/lib/mcp/core/errors';
import { readBoundedMcpText } from '@/lib/mcp/core/body';
import { mcpPolicyInForce } from '@/lib/mcp/core/kill-switch';
import { observeMcpOAuth } from '@/lib/mcp/auth/oauth-observability';
import { logger } from '@/lib/logger';
import { MCP_DEVICE_CODE_GRANT, pollMcpDeviceAuthorization } from '@/lib/mcp/auth/device-flow';
import {
  MCP_JWT_BEARER_GRANT,
  exchangeMcpEnterpriseGrant,
  mcpEnterpriseGrantIssuer,
} from '@/lib/mcp/auth/enterprise-grant';

export const runtime = 'nodejs';
const schema = z
  .object({
    grant_type: z.enum([
      'authorization_code',
      'refresh_token',
      MCP_DEVICE_CODE_GRANT,
      MCP_JWT_BEARER_GRANT,
    ]),
    client_id: z.string().max(256),
    code: z.string().max(256).optional(),
    code_verifier: z
      .string()
      .regex(/^[A-Za-z0-9._~-]{43,128}$/)
      .optional(),
    redirect_uri: z.string().url().max(2048).optional(),
    refresh_token: z.string().max(256).optional(),
    device_code: z.string().max(256).optional(),
    assertion: z.string().max(6144).optional(),
    scope: z.string().max(2048).optional(),
    resource: z.string().url().optional(),
  })
  // RFC 6749 section 3.2: unrecognized parameters are ignored, never refused.
  .strip();

export function POST(request: Request) {
  return observeMcpOAuth('token', request, () =>
    withMcpDatabase(() =>
      withMcpRuntime(() => withBrowserCors(request, origin => handlePost(request, origin)))
    )
  );
}
export const OPTIONS = browserPreflight;

async function handlePost(request: Request, browserOrigin: string | null) {
  let reused: string | undefined;
  let release: (() => void) | undefined;
  try {
    assertMcpHost(request, false, browserOrigin);
    release = await acquireMcpOAuthSlot('token');
    const policy = await prisma.mcpPolicy.findUnique({ where: { id: 'default' } });
    requireMcp(mcpPolicyInForce(policy), 'MCP_DISABLED', 503);
    await admitMcpOAuthRequest(request, 'token');
    requireMcp(
      request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ===
        'application/x-www-form-urlencoded',
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
    if (body.grant_type === MCP_DEVICE_CODE_GRANT) {
      // Not offered while the administrator has the device flow off, as metadata says.
      requireMcp(policy?.deviceFlowEnabled, 'unsupported_grant_type');
      requireMcp(body.device_code, 'invalid_request');
      return await deviceTokenResponse(body.device_code, body.client_id);
    }
    if (body.grant_type === MCP_JWT_BEARER_GRANT) {
      // Not offered unless enterprise-managed authorization is on and SSO is configured.
      requireMcp(await mcpEnterpriseGrantIssuer(policy), 'unsupported_grant_type');
      requireMcp(body.assertion, 'invalid_request');
      return await enterpriseTokenResponse(body.assertion, body.client_id, body.scope, policy);
    }
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
    if (reused) {
      const grantId = reused;
      logger.warn('mcp.token.refresh_reuse_revoked', { grantId });
      await prisma.$transaction(async tx => {
        // The revoked grant names whose session ended and which assistant it belonged to.
        const grant = await tx.mcpGrant.update({
          where: { id: grantId },
          data: { revokedAt: new Date() },
          select: { userId: true, clientId: true, client: { select: { name: true } } },
        });
        await logAudit(
          {
            source: 'AUTH',
            action: 'mcp.grant.reuse_detected',
            entityType: 'SYSTEM_CONFIG',
            entityId: grantId,
            actorId: grant.userId,
            details: {
              clientId: grant.clientId,
              clientName: grant.client.name,
              reason: 'refresh_token_reuse',
            },
          },
          tx
        );
      });
    }
    return tokenErrorResponse(error);
  } finally {
    release?.();
  }
}

/**
 * RFC 8628 §3.4-3.5. The poll runs serializable with one retry, like a refresh: of two polls at
 * once, the one that loses the race sees the code already consumed.
 */
async function deviceTokenResponse(deviceCode: string, clientId: string) {
  const poll = () =>
    prisma.$transaction(tx => pollMcpDeviceAuthorization(tx, { deviceCode, clientId }), {
      isolationLevel: 'Serializable',
      timeout: 5000,
    });
  const headers = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };
  let result;
  try {
    try {
      result = await poll();
    } catch (error) {
      if (!isSerializationConflict(innerError(error))) throw error;
      result = await poll();
    }
  } catch (error) {
    // The grant was revoked or the person's access changed between approval and this poll: the
    // whole transaction rolled back and the code stays unusable.
    if (error instanceof McpBoundaryError && OAUTH_ERRORS.has(error.code))
      return Response.json(
        { error: error.code },
        { status: error.code === 'invalid_client' ? 401 : 400, headers }
      );
    throw error;
  }
  if (result.ok) return Response.json(result.body, { headers });
  return Response.json(
    { error: result.error, ...(result.interval ? { interval: result.interval } : {}) },
    { status: result.error === 'invalid_client' ? 401 : 400, headers }
  );
}

/** ID-JAG exchange (enterprise-grant.ts): verified outside, issued serializable with one retry. */
async function enterpriseTokenResponse(
  assertion: string,
  clientId: string,
  scope: string | undefined,
  policy: McpPolicy | null
) {
  const headers = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };
  try {
    const issue = await exchangeMcpEnterpriseGrant({ assertion, clientId, scope }, policy);
    const run = () => prisma.$transaction(issue, { isolationLevel: 'Serializable', timeout: 5000 });
    let body;
    try {
      body = await run();
    } catch (error) {
      if (!isSerializationConflict(innerError(error))) throw error;
      body = await run();
    }
    return Response.json(body, { headers });
  } catch (error) {
    if (error instanceof McpBoundaryError && OAUTH_ERRORS.has(error.code))
      return Response.json(
        { error: error.code },
        { status: error.code === 'invalid_client' ? 401 : 400, headers }
      );
    throw error;
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
  // Names and codes only: form values, codes, verifiers and tokens are never logged.
  if (isTransientDatabaseError(inner)) {
    logger.warn('mcp.token.transient', {
      prismaCode: databaseCode(inner)?.code,
      state: databaseCode(inner)?.state,
    });
    return Response.json(
      {
        error: 'temporarily_unavailable',
        error_description: 'OpsKnight is briefly busy. Retry shortly; your sign-in is still valid.',
      },
      { status: 503, headers: { ...headers, 'Retry-After': '2' } }
    );
  }
  // A model check keeps its own OAuth code (invalid_scope stays invalid_scope).
  if (inner instanceof McpBoundaryError && inner !== error && OAUTH_ERRORS.has(inner.code))
    return Response.json(
      { error: inner.code },
      { status: inner.code === 'invalid_client' ? 401 : 400, headers }
    );
  if (inner instanceof McpBoundaryError) return mcpHttpError(inner);
  if (error instanceof z.ZodError)
    return Response.json({ error: 'invalid_request' }, { status: 400, headers });
  if (error instanceof OAuth2Server.ServerError) {
    logUnexpected(inner);
    return Response.json({ error: 'server_error' }, { status: 500, headers });
  }
  if (error instanceof OAuth2Server.OAuthError)
    return Response.json(
      { error: OAUTH_ERRORS.has(error.name) ? error.name : 'invalid_grant' },
      { status: error.name === 'invalid_client' ? 401 : 400, headers }
    );
  logUnexpected(inner);
  return mcpHttpError(error);
}

function logUnexpected(inner: unknown) {
  if (inner instanceof McpBoundaryError) return;
  logger.error('mcp.token.unexpected_error', {
    name: inner instanceof Error ? inner.name : typeof inner,
    prismaCode: databaseCode(inner)?.code,
  });
}
