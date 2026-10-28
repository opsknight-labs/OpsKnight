import { logAudit } from '@/lib/audit';
import { withMcpDatabase } from '@/lib/database-workload';
import OAuth2Server from '@node-oauth/oauth2-server';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { admitMcpOAuthRequest } from '@/lib/mcp/auth/admission';
import { mcpOAuthServer } from '@/lib/mcp/auth/oauth-model';
import { mcpResource } from '@/lib/mcp/auth/config';
import { assertMcpHost, mcpHttpError, uniqueQuery } from '@/lib/mcp/auth/http';
import { requireMcp } from '@/lib/mcp/core/errors';
import { readBoundedMcpText } from '@/lib/mcp/core/body';
import { acquireMcpAuthenticationSlot } from '@/lib/mcp/core/budget';

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
    resource: z.string().url(),
  })
  .strict();

export function POST(request: Request) {
  return withMcpDatabase(() => handlePost(request));
}

async function handlePost(request: Request) {
  let reused: string | undefined;
  let release: (() => void) | undefined;
  try {
    assertMcpHost(request);
    release = acquireMcpAuthenticationSlot();
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
    requireMcp(body.resource === mcpResource(), 'invalid_target');
    requireMcp(
      body.grant_type !== 'authorization_code' ||
        (body.code && body.code_verifier && body.redirect_uri),
      'invalid_request'
    );
    requireMcp(body.grant_type !== 'refresh_token' || body.refresh_token, 'invalid_request');
    const response = new OAuth2Server.Response();
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
    return error instanceof OAuth2Server.OAuthError || error instanceof z.ZodError
      ? Response.json(
          { error: 'invalid_grant' },
          { status: 400, headers: { 'Cache-Control': 'no-store' } }
        )
      : mcpHttpError(error);
  } finally {
    release?.();
  }
}
