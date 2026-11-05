import { Prisma } from '@prisma/client';
import { APP_ROLES, isAppRole } from '@/lib/authorization';

/**
 * The one definition of what an MCP grant may do right now. The SQL columns are read by the
 * request path (principal.ts) and by the settings lists, and `grantAccessVerdict` judges the row
 * the same way for both, so what the admin page shows is what the server enforces.
 *
 * Every fragment expects these aliases: g = "McpGrant", c = "McpClient", u = "User" and
 * p = "McpPolicy" (the 'default' row, outer-joined).
 */

// A metadata client's effective ceiling is always the current policy, never its stored copy.
const CLIENT_CEILING = Prisma.sql`CASE WHEN c."dynamicRegistration" THEN
    ARRAY(SELECT s FROM unnest(c.scopes) AS s WHERE s = ANY(p."dcrScopes"))
    WHEN c."metadataUrl" IS NULL THEN c.scopes
    ELSE ARRAY(SELECT s FROM unnest(c.scopes) AS s WHERE s = ANY(p."cimdScopes")) END`;

// "clientTrusted" folds in what used to be WHERE conditions so a token whose client is no longer
// trusted is told apart from an unknown token.
const CLIENT_TRUSTED = Prisma.sql`COALESCE((NOT c."dynamicRegistration" OR p."dcrEnabled")
    -- A metadata-document client stays valid only while its host remains trusted (substr skips https://).
    AND (c."metadataUrl" IS NULL OR (p."cimdEnabled"
      AND (cardinality(p."cimdAllowedHosts") = 0
        OR split_part(substr(c."metadataUrl", 9), '/', 1) = ANY(p."cimdAllowedHosts")))), false)`;

/** The client side of the snapshot: depends on c and p only. */
export const CLIENT_ACCESS_COLUMNS = Prisma.sql`
  ${CLIENT_CEILING} AS "clientScopes",
  ${CLIENT_TRUSTED} AS "clientTrusted",
  c."revokedAt" AS "clientRevokedAt",
  p.enabled AS "policyEnabled"`;

/** Everything `grantAccessVerdict` reads. */
export const GRANT_ACCESS_COLUMNS = Prisma.sql`
  g.id AS "grantId", g."userId", g."userRevocationVersion",
  g.scopes AS "grantScopes", g.resource, g."revokedAt", g."expiresAt",
  ${CLIENT_ACCESS_COLUMNS},
  u.role::text AS role, u.status::text AS status, u."mcpRevocationVersion"`;

export interface GrantAccessSnapshot {
  grantId: string;
  userId: string;
  userRevocationVersion: number;
  grantScopes: string[];
  resource: string;
  revokedAt: Date | null;
  expiresAt: Date;
  clientScopes: string[];
  clientTrusted: boolean;
  clientRevokedAt: Date | null;
  policyEnabled: boolean | null;
  role: string | null;
  status: string | null;
  mcpRevocationVersion: number | null;
}

/**
 * Why a grant gives no access right now, in the order the request path checks it.
 * - ended: revoked, expired, or issued for another server address.
 * - client_revoked: the assistant itself was revoked.
 * - client_untrusted: policy no longer trusts the assistant (automatic connections off, host
 *   not in the trusted list).
 * - user_inactive: the person is not active or has no valid role.
 * - access_changed: a security event (password, demotion from ADMIN, sign-out everywhere).
 * - admin_scope: carries a scope MCP never honours.
 */
export type McpGrantBlock =
  | 'ended'
  | 'client_revoked'
  | 'client_untrusted'
  | 'user_inactive'
  | 'access_changed'
  | 'admin_scope';

/** The MCP error each block produces on the request path. */
export const MCP_GRANT_BLOCK_ERROR = {
  ended: 'MCP_INVALID_GRANT',
  client_revoked: 'MCP_INVALID_GRANT',
  client_untrusted: 'MCP_INVALID_GRANT',
  user_inactive: 'MCP_INACTIVE_PRINCIPAL',
  access_changed: 'MCP_ACCESS_CHANGED',
  admin_scope: 'MCP_INVALID_SCOPE',
} as const satisfies Record<McpGrantBlock, string>;

export function mcpGrantBlockError(block: McpGrantBlock) {
  return new Map<McpGrantBlock, string>(
    Object.entries(MCP_GRANT_BLOCK_ERROR) as [McpGrantBlock, string][]
  ).get(block)!;
}

/**
 * Judge a snapshot. `resource` is this server's MCP address; null skips that check (the admin
 * page before the address is configured). The MCP master switch is not part of the verdict: the
 * request path reports it separately (MCP_DISABLED), and the lists show it as its own reason.
 */
export function grantAccessVerdict(
  row: GrantAccessSnapshot,
  now: Date,
  resource: string | null
): { block: McpGrantBlock | null; effectiveScopes: string[] } {
  const effectiveScopes = row.grantScopes.filter(scope => row.clientScopes.includes(scope));
  const block: McpGrantBlock | null =
    row.revokedAt || row.expiresAt <= now || (resource !== null && row.resource !== resource)
      ? 'ended'
      : row.clientRevokedAt
        ? 'client_revoked'
        : !row.clientTrusted
          ? 'client_untrusted'
          : row.status !== 'ACTIVE' || !isAppRole(row.role ?? '')
            ? 'user_inactive'
            : row.mcpRevocationVersion !== row.userRevocationVersion
              ? 'access_changed'
              : effectiveScopes.includes('admin:manage')
                ? 'admin_scope'
                : null;
  return { block, effectiveScopes: block ? [] : effectiveScopes };
}

/**
 * The SQL twin of `grantAccessVerdict(...).block === null && policy enabled`, for counts.
 * Kept next to the verdict and pinned by the effective-access parity test.
 */
export function usableGrantSql(now: Date, resource: string | null) {
  return Prisma.sql`(g."revokedAt" IS NULL AND g."expiresAt" > ${now}
    AND (${resource}::text IS NULL OR g.resource = ${resource})
    AND c."revokedAt" IS NULL AND ${CLIENT_TRUSTED}
    AND u.status::text = 'ACTIVE' AND u.role::text = ANY(${[...APP_ROLES]}::text[])
    AND u."mcpRevocationVersion" = g."userRevocationVersion"
    AND NOT ('admin:manage' = ANY(${CLIENT_CEILING}) AND 'admin:manage' = ANY(g.scopes))
    AND COALESCE(p.enabled, false))`;
}
