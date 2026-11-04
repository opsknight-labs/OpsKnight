import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { authorizationActorFromUser } from '@/lib/authorization-actors';
import { incrementSharedCounter } from '@/lib/rate-limit';
import type { V2AuthContext } from '@/lib/api-v2/auth';
import { digestMcpSecret, mcpResource } from './config';
import { McpBoundaryError, requireMcp } from '../core/errors';
import { admitMcpBearer, recordMcpBearerFailure } from './admission';

interface GrantAuthoritySnapshot {
  grantId: string;
  userId: string;
  userRevocationVersion: number;
  grantScopes: string[];
  clientScopes: string[];
  resource: string;
  revokedAt: Date | null;
  clientRevokedAt: Date | null;
  expiresAt: Date;
  role: string | null;
  status: string | null;
  mcpRevocationVersion: number | null;
  teamIds: string[];
  clientTrusted: boolean;
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

// The authority columns shared by both lookups. "clientTrusted" folds in what used to be WHERE
// conditions so a token whose client is no longer trusted is told apart from an unknown token.
const AUTHORITY_COLUMNS = Prisma.sql`
  g.id AS "grantId", g."userId", g."userRevocationVersion",
  g.scopes AS "grantScopes", g.resource,
  -- A metadata client's effective ceiling is always the current policy, never its stored copy.
  CASE WHEN c."dynamicRegistration" THEN
    ARRAY(SELECT s FROM unnest(c.scopes) AS s WHERE s = ANY(p."dcrScopes"))
    WHEN c."metadataUrl" IS NULL THEN c.scopes
    ELSE ARRAY(SELECT s FROM unnest(c.scopes) AS s WHERE s = ANY(p."cimdScopes")) END
    AS "clientScopes",
  COALESCE((NOT c."dynamicRegistration" OR p."dcrEnabled")
    -- A metadata-document client stays valid only while its host remains trusted (substr skips https://).
    AND (c."metadataUrl" IS NULL OR (p."cimdEnabled"
      AND (cardinality(p."cimdAllowedHosts") = 0
        OR split_part(substr(c."metadataUrl", 9), '/', 1) = ANY(p."cimdAllowedHosts")))), false)
    AS "clientTrusted",
  g."revokedAt", c."revokedAt" AS "clientRevokedAt", g."expiresAt",
  u.role::text AS role, u.status::text AS status, u."mcpRevocationVersion",
  ARRAY(SELECT tm."teamId" FROM "TeamMember" tm WHERE tm."userId" = u.id) AS "teamIds",
  -- The policy row this request is judged by; already joined for the client ceilings.
  p.enabled AS "policyEnabled", p."writesEnabled", p."sensitiveReadsEnabled",
  p."maxInFlight", p."maxOperations", p."requestsPerMinute", p."disabledCapabilities"`;

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
    SELECT ${AUTHORITY_COLUMNS}
    FROM "McpGrant" g JOIN "McpClient" c ON c.id = g."clientId"
    LEFT JOIN "User" u ON u.id = g."userId"
    LEFT JOIN "McpPolicy" p ON p.id = 'default'
    WHERE g.id = ${grantId}
      AND (${credentialId ?? null}::text IS NULL OR EXISTS (
        SELECT 1 FROM "McpToken" t WHERE t.id = ${credentialId ?? null}
          AND t."grantId" = g.id AND t."rotatedAt" IS NULL AND t."accessExpiresAt" > ${now}
      ))
  `;
  return authorityFrom(grant, now);
}

function authorityFrom(
  grant: GrantAuthoritySnapshot | undefined,
  now: Date
): { auth: V2AuthContext; policy: McpRuntimePolicy | null } {
  requireMcp(
    grant &&
      grant.clientTrusted &&
      !grant.revokedAt &&
      !grant.clientRevokedAt &&
      grant.expiresAt > now &&
      grant.resource === mcpResource(),
    'MCP_INVALID_GRANT',
    401
  );
  requireMcp(grant.status === 'ACTIVE', 'MCP_INACTIVE_PRINCIPAL', 401);
  // Only security events (password, email, deactivation, sign-out everywhere, demotion from ADMIN)
  // end a connection; other role and team edits narrow access live through authorize().
  requireMcp(grant.mcpRevocationVersion === grant.userRevocationVersion, 'MCP_ACCESS_CHANGED', 401);
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

interface BearerSnapshot extends Partial<GrantAuthoritySnapshot> {
  tokenId: string;
  tokenGrantId: string;
  tokenScopes: string[];
  rotatedAt: Date | null;
  accessExpiresAt: Date;
  lastUsedAt: Date | null;
}

/**
 * The bearer's token, its grant's authority and the policy in one statement. The grant side is
 * outer-joined so a known token with a failing grant is still told apart from an unknown one.
 */
async function resolveBearer(accessHash: string) {
  const [row] = await prisma.$queryRaw<BearerSnapshot[]>`
    SELECT t.id AS "tokenId", t."grantId" AS "tokenGrantId", t.scopes AS "tokenScopes",
      t."rotatedAt", t."accessExpiresAt", t."lastUsedAt", ${AUTHORITY_COLUMNS}
    FROM "McpToken" t
    LEFT JOIN "McpGrant" g ON g.id = t."grantId"
    LEFT JOIN "McpClient" c ON c.id = g."clientId"
    LEFT JOIN "User" u ON u.id = g."userId"
    LEFT JOIN "McpPolicy" p ON p.id = 'default'
    WHERE t."accessHash" = ${accessHash}
  `;
  return row;
}

/** Authentication can precede body parsing; charge the validated cost separately in that case. */
export async function authenticateMcp(request: Request, cost: number | null) {
  // The policy is read with the grant. A disabled MCP still answers MCP_DISABLED ahead of any
  // credential error, so a failure reads the policy on its own before reporting the cause.
  let resolved: Awaited<ReturnType<typeof resolveMcpGrantWithPolicy>>;
  let token: { id: string; grantId: string; scopes: string[]; lastUsedAt: Date | null };
  admitMcpBearer(request);
  // Only a credential OpsKnight never issued counts against the peer. An expired or revoked token
  // is a normal refresh, and many users can share one egress address (claude.ai), so counting it
  // would lock everyone behind that address out.
  let unknownCredential = true;
  try {
    const header = request.headers.get('authorization') ?? '';
    requireMcp(/^Bearer [A-Za-z0-9_-]{32,256}$/.test(header), 'MCP_INVALID_TOKEN', 401);
    const row = await resolveBearer(digestMcpSecret(header.slice(7)));
    unknownCredential = !row;
    const now = new Date();
    requireMcp(row && !row.rotatedAt && row.accessExpiresAt > now, 'MCP_INVALID_TOKEN', 401);
    token = {
      id: row.tokenId,
      grantId: row.tokenGrantId,
      scopes: row.tokenScopes,
      lastUsedAt: row.lastUsedAt,
    };
    // The same checks as resolveMcpGrantWithPolicy, judged on the row read with the token.
    resolved = authorityFrom(row.grantId ? (row as GrantAuthoritySnapshot) : undefined, now);
  } catch (error) {
    if (
      unknownCredential &&
      error instanceof McpBoundaryError &&
      error.code === 'MCP_INVALID_TOKEN'
    )
      recordMcpBearerFailure(request);
    requireMcp((await loadRuntimePolicy())?.enabled, 'MCP_DISABLED', 503);
    throw error;
  }
  const { auth, policy } = resolved;
  requireMcp(policy?.enabled, 'MCP_DISABLED', 503);
  // A used access token ends the refresh grace window for its predecessor. Written at most once
  // a minute per token, and never on a failed authentication.
  const now = Date.now();
  if (!token.lastUsedAt || now - token.lastUsedAt.getTime() > 60000)
    await prisma.mcpToken.updateMany({
      where: {
        id: token.id,
        OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: new Date(now - 60000) } }],
      },
      data: { lastUsedAt: new Date(now) },
    });
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
  if (quota.count > identity.policy.requestsPerMinute)
    // The quota is a fixed one-minute window: tell the client when it actually reopens.
    throw new McpBoundaryError('MCP_RATE_LIMITED', 429, true, undefined, {
      retryAfterSeconds: Math.min(60, Math.max(1, Math.ceil((quota.resetAt - Date.now()) / 1000))),
    });
}
