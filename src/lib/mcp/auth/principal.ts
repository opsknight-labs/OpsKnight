import prisma from '@/lib/prisma';
import { authorizationActorFromUser } from '@/lib/authorization-actors';
import { incrementSharedCounter } from '@/lib/rate-limit';
import type { V2AuthContext } from '@/lib/api-v2/auth';
import { digestMcpSecret, mcpResource } from './config';
import { requireMcp } from '../core/errors';

export async function resolveMcpGrant(
  grantId: string,
  credentialId?: string
): Promise<V2AuthContext> {
  const grant = await prisma.mcpGrant.findUnique({
    where: {
      id: grantId,
      ...(credentialId
        ? {
            tokens: {
              some: { id: credentialId, rotatedAt: null, accessExpiresAt: { gt: new Date() } },
            },
          }
        : {}),
    },
    include: { client: true },
  });
  requireMcp(
    grant &&
      !grant.revokedAt &&
      !grant.client.revokedAt &&
      grant.expiresAt > new Date() &&
      grant.resource === mcpResource(),
    'MCP_INVALID_GRANT',
    401
  );
  const user = await prisma.user.findUnique({
    where: { id: grant.userId },
    select: {
      id: true,
      role: true,
      status: true,
      tokenVersion: true,
      teamMemberships: { select: { teamId: true } },
    },
  });
  requireMcp(
    user && user.status === 'ACTIVE' && user.tokenVersion === grant.userTokenVersion,
    'MCP_INACTIVE_PRINCIPAL',
    401
  );
  const base = authorizationActorFromUser(user);
  requireMcp(base, 'MCP_INACTIVE_PRINCIPAL', 401);
  const scopes = grant.scopes.filter(scope => grant.client.scopes.includes(scope));
  // Never inherit REST's admin:manage wildcard from an MCP consent grant.
  requireMcp(!scopes.includes('admin:manage'), 'MCP_INVALID_SCOPE', 403);
  const id = `mcp:${grant.id}`;
  return {
    actor: { ...base, apiKey: { id, scopes } },
    apiKey: {
      id,
      name: 'MCP',
      prefix: 'mcp',
      tokenHash: '',
      userId: user.id,
      scopes,
      isServiceAccount: false,
    },
  };
}

export async function authenticateMcp(request: Request, cost: number) {
  const policy = await prisma.mcpPolicy.findUnique({ where: { id: 'default' } });
  requireMcp(policy?.enabled, 'MCP_DISABLED', 503);
  const header = request.headers.get('authorization') ?? '';
  requireMcp(/^Bearer [A-Za-z0-9_-]{32,256}$/.test(header), 'MCP_INVALID_TOKEN', 401);
  const token = await prisma.mcpToken.findUnique({
    where: { accessHash: digestMcpSecret(header.slice(7)) },
  });
  requireMcp(
    token && !token.rotatedAt && token.accessExpiresAt > new Date(),
    'MCP_INVALID_TOKEN',
    401
  );
  const auth = await resolveMcpGrant(token.grantId, token.id);
  const effectiveScopes = auth.apiKey.scopes.filter(scope => token.scopes.includes(scope));
  auth.apiKey.scopes = effectiveScopes;
  auth.actor.apiKey = { id: auth.apiKey.id, scopes: effectiveScopes };
  // Charge the declared bounded plan before executing it. This is shared across replicas.
  const quota = await incrementSharedCounter(`mcp:${token.grantId}`, 60000, 'application', cost);
  requireMcp(quota.count <= policy.requestsPerMinute, 'MCP_RATE_LIMITED', 429);
  return {
    auth,
    grantId: token.grantId,
    credentialId: token.id,
    tokenScopes: token.scopes,
    policy,
  };
}
