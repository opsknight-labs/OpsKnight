import { NextResponse } from 'next/server';
import { withMcpDatabase } from '@/lib/database-workload';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/rbac';
import { checkRateLimit } from '@/lib/rate-limit';
import { mcpIssuer, mcpOrigin, mcpResource, withMcpRuntime } from '@/lib/mcp/auth/config';
import { assertMcpHost, authorizationQuerySchema, uniqueQuery } from '@/lib/mcp/auth/http';
import { McpBoundaryError, requireMcp } from '@/lib/mcp/core/errors';
import { isCimdClientId, resolveCimdClient } from '@/lib/mcp/auth/cimd';
import { AppError } from '@/lib/errors';
import { friendlyMcpError, mcpErrorPage, oauthErrorFor } from '@/lib/mcp/auth/friendly-error';
import { effectiveMcpClientScopes } from '@/lib/mcp/auth/client-policy';
import { logger } from '@/lib/logger';
import { redirectUriAllowed, urlForLog } from '@/lib/mcp/auth/redirect-uri';
import { z } from 'zod/v3';

export function GET(request: Request) {
  return withMcpDatabase(() => withMcpRuntime(() => handleGet(request)));
}

async function handleGet(request: Request) {
  // Set once the client and its exact redirect URI are verified; only then is it safe to send
  // failures back to the assistant instead of showing them in the browser.
  let trusted: { redirectUri: string; state: string } | undefined;
  try {
    assertMcpHost(request);
    const policy = await prisma.mcpPolicy.findUnique({ where: { id: 'default' } });
    requireMcp(policy?.enabled, 'MCP_DISABLED', 503);
    const user = await getCurrentUser();
    requireMcp(user.status === 'ACTIVE', 'MCP_INACTIVE_PRINCIPAL', 403);
    requireMcp(
      (await checkRateLimit(`mcp:consent:${user.id}`, 10, 60000)).allowed,
      'MCP_RATE_LIMITED',
      429
    );
    const query = authorizationQuerySchema.parse(uniqueQuery(new URL(request.url).searchParams));
    requireMcp(!query.resource || query.resource === mcpResource(), 'invalid_target');
    let client;
    if (isCimdClientId(query.client_id)) {
      // Bounded outbound fetch: one attempt per request and a separate per-user budget.
      requireMcp(
        (await checkRateLimit(`mcp:cimd:${user.id}`, 6, 60000)).allowed,
        'MCP_RATE_LIMITED',
        429
      );
      client = await resolveCimdClient(prisma, policy, query.client_id, query.redirect_uri);
    } else {
      client = await prisma.mcpClient.findUnique({ where: { id: query.client_id } });
    }
    if (
      !client ||
      client.revokedAt ||
      !redirectUriAllowed(client.redirectUris, query.redirect_uri)
    ) {
      // Administrators otherwise only see "invalid_client"; say which check failed.
      logger.warn('mcp.authorize.client_denied', {
        clientId: urlForLog(query.client_id),
        reason: !client
          ? 'unknown_client_id'
          : client.revokedAt
            ? 'client_revoked'
            : 'redirect_uri_not_registered',
        ...(client
          ? {
              registeredRedirectUris: client.redirectUris.map(urlForLog),
              requestedRedirectUri: urlForLog(query.redirect_uri),
            }
          : {}),
      });
      // A missing id is almost always one the assistant cached from an earlier registration.
      throw new McpBoundaryError(client ? 'invalid_client' : 'MCP_CLIENT_UNKNOWN');
    }
    trusted = { redirectUri: query.redirect_uri, state: query.state };
    const ceiling = effectiveMcpClientScopes(client, policy);
    if (!ceiling?.length) {
      logger.warn('mcp.authorize.client_denied', {
        clientId: client.id.slice(0, 256),
        reason: 'no_scopes_allowed_for_this_client',
        registration: client.metadataUrl
          ? 'metadata_document'
          : client.dynamicRegistration
            ? 'automatic'
            : 'manual',
      });
      throw new McpBoundaryError('invalid_client');
    }
    // Assistants often ask for generic scopes (openid, offline_access) or more than policy allows;
    // grant what the policy permits instead of failing the whole connection.
    const asked = query.scope ? [...new Set(query.scope.split(' '))] : [];
    const allowed = ceiling.filter(scope => scope !== 'admin:manage');
    const narrowed = asked.filter(scope => allowed.includes(scope));
    const scopes = narrowed.length ? narrowed : allowed;
    requireMcp(scopes.length > 0, 'invalid_scope');
    const pending = await prisma.$transaction(async tx => {
      // Coordinate unused-registration cleanup with creation of a live consent form.
      await tx.$queryRaw`SELECT id FROM "McpClient" WHERE id = ${client.id} FOR SHARE`;
      const current = await tx.mcpClient.findUnique({ where: { id: client.id } });
      requireMcp(
        current &&
          !current.revokedAt &&
          redirectUriAllowed(current.redirectUris, query.redirect_uri),
        'invalid_client'
      );
      return tx.mcpConsentRequest.create({
        data: {
          userId: user.id,
          clientId: client.id,
          redirectUri: query.redirect_uri,
          scopes,
          // Consent pre-selects a change permission only when the assistant asked for it by name.
          requestedScopes: narrowed,
          state: query.state,
          challenge: query.code_challenge,
          expiresAt: new Date(Date.now() + 300000),
        },
      });
    });
    return NextResponse.redirect(new URL(`/oauth/mcp/consent?id=${pending.id}`, mcpOrigin()));
  } catch (error) {
    if (
      error instanceof AppError &&
      (error.code === 'AUTHENTICATION_REQUIRED' || error.code === 'SESSION_REVOKED')
    ) {
      const login = new URL('/login', mcpOrigin());
      login.searchParams.set(
        'callbackUrl',
        new URL(request.url).pathname + new URL(request.url).search
      );
      return NextResponse.redirect(login);
    }
    if (trusted && error instanceof McpBoundaryError) {
      const target = new URL(trusted.redirectUri);
      target.searchParams.set('error', oauthErrorFor(error.code));
      target.searchParams.set('error_description', friendlyMcpError(error.code).body);
      target.searchParams.set('state', trusted.state);
      target.searchParams.set('iss', mcpIssuer());
      return NextResponse.redirect(target);
    }
    // Only parameter names are logged: values can carry state, challenges or hints.
    if (error instanceof z.ZodError) {
      logger.warn('mcp.authorize.invalid_request', {
        fields: [...new Set(error.issues.map(issue => issue.path.join('.') || 'query'))],
      });
      return mcpErrorPage(new McpBoundaryError('invalid_request', 400));
    }
    if (!(error instanceof McpBoundaryError))
      logger.warn('mcp.authorize.unexpected_error', {
        name: error instanceof Error ? error.name : typeof error,
      });
    return mcpErrorPage(error);
  }
}
