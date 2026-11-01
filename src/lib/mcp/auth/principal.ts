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
  policyEnabled: boolean | null;
  writesEnabled: boolean | null;
  sensitiveReadsEnabled: boolean | null;
  maxInFlight: number | null;
  maxOperations: number | null;
  requestsPerMinute: number | null;
  disabledCapabilities: string[] | null;
}

/** The runtime switches and bounds of the MCP policy, read with the grant in one statement. */
export interface McpRuntimePolicy {
  enabled: boolean;
  writesEnabled: boolean;
  sensitiveReadsEnabled: boolean;
  maxInFlight: number;
  maxOperations: number;
  requestsPerMinute: number;
  disabledCapabilities: string[];
}

const loadRuntimePolicy = async (): Promise<McpRuntimePolicy | null> =>
  prisma.mcpPolicy.findUnique({
    where: { id: 'default' },
    select: {
      enabled: true,
      writesEnabled: true,
      sensitiveReadsEnabled: true,
      maxInFlight: true,
      maxOperations: true,
      requestsPerMinute: true,
      disabledCapabilities: true,
    },
  });

export async function resolveMcpGrant(
  grantId: string,
  credentialId?: string,
  db: Prisma.TransactionClient = prisma
): Promise<V2AuthContext> {
  return (await resolveMcpGrantWithPolicy(grantId, credentialId, db)).auth;
}

/**
 * The grant's current authority and the MCP policy as of the same statement. The policy is null
 * when no policy row exists. Callers that must report a disabled policy ahead of a grant failure
 * read the policy separately on that failure path only.
 */
export async function resolveMcpGrantWithPolicy(
  grantId: string,
  credentialId?: string,
  db: Prisma.TransactionClient = prisma
): Promise<{ auth: V2AuthContext; policy: McpRuntimePolicy | null }> {
  const now = new Date();
  // One current-statement snapshot avoids four ORM round trips per domain step.
  // No values are interpolated into SQL syntax and no authority is cached.
  const [grant] = await db.$queryRaw<GrantAuthoritySnapshot[]>`
    SELECT g.id AS "grantId", g."userId", g."userTokenVersion",
      g.scopes AS "grantScopes", g.resource,
      -- A metadata client's effective ceiling is always the current policy, never its stored copy.
      CASE WHEN c."dynamicRegistration" THEN
        ARRAY(SELECT s FROM unnest(c.scopes) AS s WHERE s = ANY(p."dcrScopes"))
        WHEN c."metadataUrl" IS NULL THEN c.scopes
        ELSE ARRAY(SELECT s FROM unnest(c.scopes) AS s WHERE s = ANY(p."cimdScopes")) END
        AS "clientScopes",
      g."revokedAt", c."revokedAt" AS "clientRevokedAt", g."expiresAt",
      u.role::text AS role, u.status::text AS status, u."tokenVersion",
      ARRAY(SELECT tm."teamId" FROM "TeamMember" tm WHERE tm."userId" = u.id) AS "teamIds",
      -- The policy row this request is judged by; already joined for the client ceilings.
      p.enabled AS "policyEnabled", p."writesEnabled", p."sensitiveReadsEnabled",
      p."maxInFlight", p."maxOperations", p."requestsPerMinute", p."disabledCapabilities"
    FROM "McpGrant" g JOIN "McpClient" c ON c.id = g."clientId"
    LEFT JOIN "User" u ON u.id = g."userId"
    LEFT JOIN "McpPolicy" p ON p.id = 'default'
    WHERE g.id = ${grantId}
      AND (NOT c."dynamicRegistration" OR p."dcrEnabled")
      -- A metadata-document client stays valid only while its host remains trusted (substr skips https://).
      AND (c."metadataUrl" IS NULL OR (p."cimdEnabled"
        AND (cardinality(p."cimdAllowedHosts") = 0
          OR split_part(substr(c."metadataUrl", 9), '/', 1) = ANY(p."cimdAllowedHosts"))))
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
    auth: {
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
    },
    policy:
      grant.policyEnabled === null
        ? null
        : {
            enabled: grant.policyEnabled,
            writesEnabled: grant.writesEnabled!,
            sensitiveReadsEnabled: grant.sensitiveReadsEnabled!,
            maxInFlight: grant.maxInFlight!,
            maxOperations: grant.maxOperations!,
            requestsPerMinute: grant.requestsPerMinute!,
            disabledCapabilities: grant.disabledCapabilities ?? [],
          },
  };
}

/** Authentication can precede body parsing; charge the validated cost separately in that case. */
export async function authenticateMcp(request: Request, cost: number | null) {
  // The policy is read with the grant. A disabled MCP still answers MCP_DISABLED ahead of any
  // credential error, so a failure reads the policy on its own before reporting the cause.
  let resolved: Awaited<ReturnType<typeof resolveMcpGrantWithPolicy>>;
  let token: { id: string; grantId: string; scopes: string[] };
  try {
    const header = request.headers.get('authorization') ?? '';
    requireMcp(/^Bearer [A-Za-z0-9_-]{32,256}$/.test(header), 'MCP_INVALID_TOKEN', 401);
    const found = await prisma.mcpToken.findUnique({
      where: { accessHash: digestMcpSecret(header.slice(7)) },
    });
    requireMcp(
      found && !found.rotatedAt && found.accessExpiresAt > new Date(),
      'MCP_INVALID_TOKEN',
      401
    );
    token = found;
    resolved = await resolveMcpGrantWithPolicy(token.grantId, token.id);
  } catch (error) {
    requireMcp((await loadRuntimePolicy())?.enabled, 'MCP_DISABLED', 503);
    throw error;
  }
  const { auth, policy } = resolved;
  requireMcp(policy?.enabled, 'MCP_DISABLED', 503);
  const effectiveScopes = auth.apiKey.scopes.filter(scope => token.scopes.includes(scope));
  auth.apiKey.scopes = effectiveScopes;
  auth.actor.apiKey = { id: auth.apiKey.id, scopes: effectiveScopes };
  if (cost !== null) await chargeMcpRequest({ grantId: token.grantId, policy }, cost);
  return {
    auth,
    grantId: token.grantId,
    credentialId: token.id,
    tokenScopes: token.scopes,
    policy,
  };
}

/** Charge the declared bounded plan once, after authenticating and validating its body. */
export async function chargeMcpRequest(
  identity: { grantId: string; policy: { requestsPerMinute: number } },
  cost: number
) {
  const quota = await incrementSharedCounter(`mcp:${identity.grantId}`, 60000, 'application', cost);
  requireMcp(quota.count <= identity.policy.requestsPerMinute, 'MCP_RATE_LIMITED', 429);
}
