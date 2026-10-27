import prisma from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { authorizationActorFromUser } from '@/lib/authorization-actors';
import { incrementSharedCounter } from '@/lib/rate-limit';
import type { V2AuthContext } from '@/lib/api-v2/auth';
import { digestMcpSecret, mcpResource } from './config';
import { requireMcp } from '../core/errors';

interface GrantAuthoritySnapshot {
  grantId: string;
  userId: string;
  userTokenVersion: number;
  grantScopes: string[];
  clientScopes: string[];
  resource: string;
  revokedAt: Date | null;
  clientRevokedAt: Date | null;
  expiresAt: Date;
  role: string | null;
  status: string | null;
  tokenVersion: number | null;
  teamIds: string[];
}

export async function resolveMcpGrant(
  grantId: string,
  credentialId?: string,
  db: Prisma.TransactionClient = prisma
): Promise<V2AuthContext> {
  const now = new Date();
  // One current-statement snapshot avoids four ORM round trips per domain step.
  // No values are interpolated into SQL syntax and no authority is cached.
  const [grant] = await db.$queryRaw<GrantAuthoritySnapshot[]>`
    SELECT g.id AS "grantId", g."userId", g."userTokenVersion",
      g.scopes AS "grantScopes", c.scopes AS "clientScopes", g.resource,
      g."revokedAt", c."revokedAt" AS "clientRevokedAt", g."expiresAt",
      u.role::text AS role, u.status::text AS status, u."tokenVersion",
      ARRAY(SELECT tm."teamId" FROM "TeamMember" tm WHERE tm."userId" = u.id) AS "teamIds"
    FROM "McpGrant" g JOIN "McpClient" c ON c.id = g."clientId"
    LEFT JOIN "User" u ON u.id = g."userId"
    LEFT JOIN "McpPolicy" p ON p.id = 'default'
    WHERE g.id = ${grantId}
      -- A metadata-document client stays valid only while its host remains trusted (substr skips https://).
      AND (c."metadataUrl" IS NULL OR (p."cimdEnabled"
        AND split_part(substr(c."metadataUrl", 9), '/', 1) = ANY(p."cimdAllowedHosts")))
      AND (${credentialId ?? null}::text IS NULL OR EXISTS (
        SELECT 1 FROM "McpToken" t WHERE t.id = ${credentialId ?? null}
          AND t."grantId" = g.id AND t."rotatedAt" IS NULL AND t."accessExpiresAt" > ${now}
      ))
  `;
  requireMcp(
    grant &&
      !grant.revokedAt &&
      !grant.clientRevokedAt &&
      grant.expiresAt > now &&
      grant.resource === mcpResource(),
    'MCP_INVALID_GRANT',
    401
  );
  requireMcp(
    grant.status === 'ACTIVE' && grant.tokenVersion === grant.userTokenVersion,
    'MCP_INACTIVE_PRINCIPAL',
    401
  );
  const base = authorizationActorFromUser({
    id: grant.userId,
    role: grant.role ?? '',
    status: grant.status ?? '',
    teamMemberships: grant.teamIds.map(teamId => ({ teamId })),
  });
  requireMcp(base, 'MCP_INACTIVE_PRINCIPAL', 401);
  const scopes = grant.grantScopes.filter(scope => grant.clientScopes.includes(scope));
  // Never inherit REST's admin:manage wildcard from an MCP consent grant.
  requireMcp(!scopes.includes('admin:manage'), 'MCP_INVALID_SCOPE', 403);
  const id = `mcp:${grant.grantId}`;
  return {
    actor: { ...base, apiKey: { id, scopes } },
    apiKey: {
      id,
      name: 'MCP',
      prefix: 'mcp',
      tokenHash: '',
      userId: grant.userId,
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
