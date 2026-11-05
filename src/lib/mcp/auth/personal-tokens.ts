import { randomBytes } from 'node:crypto';
import type { McpPolicy, Prisma } from '@prisma/client';
import { logAudit } from '@/lib/audit';
import { isAppRole, type AppRole } from '@/lib/authorization';
import { isAuthenticationFresh } from '@/lib/auth-control/actor';
import { digestMcpSecret, mcpResource } from './config';
import { isMcpViewScope } from './consent-offer';
import { MCP_PAT_CLIENT_ID, MCP_PAT_FORBIDDEN_SCOPES } from './effective-access';
import { mcpScopesUsableByRole } from './role-scopes';
import { supportedMcpScopes } from './scopes';
import { MCP_ABSOLUTE_SESSION_DAYS } from './session-lifetime';

/**
 * Personal access tokens: a long-lived bearer for agents that cannot run an OAuth sign-in (API
 * hosted agents, CI, workflow tools). A token is an McpGrant of kind PAT with exactly one McpToken
 * whose access secret is the token. It can never be refreshed, and the request path judges it like
 * any other connection (principal.ts), with the personal-token policy as its ceiling.
 */

/** Recognisable by secret scanners. The rest is 32 random bytes, base64url. */
export const MCP_PAT_PREFIX = 'okmcp_pat_';
export { MCP_PAT_CLIENT_ID };
export const MCP_PAT_MAX_DAYS = MCP_ABSOLUTE_SESSION_DAYS;
export const MCP_PAT_DEFAULT_DAYS = 30;
/** Live personal tokens one person may hold at a time. */
export const MCP_PAT_PER_USER_LIMIT = 20;
/** The owner is told this many days before a personal token expires. */
export const MCP_PAT_EXPIRY_NOTICE_DAYS = 7;
const DAY_MS = 86_400_000;

type PatPolicy = Pick<
  McpPolicy,
  'enabled' | 'patEnabled' | 'patMaxDays' | 'patAllowedScopes' | 'requireReadOnlyConnections'
>;

/** The longest expiry the policy allows, within the hard cap. */
export function mcpPatMaxDays(policy: Pick<McpPolicy, 'patMaxDays'> | null) {
  return Math.min(Math.max(policy?.patMaxDays ?? MCP_PAT_DEFAULT_DAYS, 1), MCP_PAT_MAX_DAYS);
}

/** Expiry choices offered by the form: the usual lengths that fit, plus the policy maximum. */
export function mcpPatExpiryChoices(policy: Pick<McpPolicy, 'patMaxDays'> | null) {
  const max = mcpPatMaxDays(policy);
  return [...new Set([7, 30, 60, 90].filter(days => days < max).concat(max))];
}

/**
 * What a personal token for this role may carry: the policy's list, within what MCP supports and
 * the role can use, never `runbooks:execute`, and reads only when view-only connections are
 * required.
 */
export function mcpPatScopeChoices(
  policy: Pick<McpPolicy, 'patAllowedScopes' | 'requireReadOnlyConnections'> | null,
  role: AppRole
) {
  if (!policy) return [];
  const supported = supportedMcpScopes();
  const usable = mcpScopesUsableByRole(role);
  return [...new Set(policy.patAllowedScopes)].filter(
    scope =>
      supported.has(scope) &&
      usable.has(scope) &&
      !MCP_PAT_FORBIDDEN_SCOPES.includes(scope) &&
      (!policy.requireReadOnlyConnections || isMcpViewScope(scope))
  );
}

export type McpPatCreateResult =
  | { ok: true; token: string; grantId: string; scopes: string[]; expiresAt: Date }
  | {
      ok: false;
      code:
        | 'MCP_DISABLED'
        | 'MCP_PAT_DISABLED'
        | 'MCP_REAUTHENTICATION_REQUIRED'
        | 'MCP_INACTIVE_PRINCIPAL'
        | 'MCP_INVALID_NAME'
        | 'MCP_INVALID_SCOPE'
        | 'MCP_PAT_INVALID_EXPIRY'
        | 'MCP_PAT_LIMIT_REACHED';
      field?: 'label' | 'scopes' | 'expiresInDays';
    };

/**
 * Create a personal token for the signed-in person. The caller passes the session's sign-in time;
 * a token is a long-lived secret, so it needs a recent sign-in like other sensitive changes. The
 * token is returned once and only its digest is stored.
 */
export async function createMcpPersonalToken(
  tx: Prisma.TransactionClient,
  input: { label: string; scopes: readonly string[]; expiresInDays: number },
  actor: { id: string; tokenVersion: number; authenticatedAt: number | null | undefined }
): Promise<McpPatCreateResult> {
  if (!isAuthenticationFresh(actor.authenticatedAt, 'admin'))
    return { ok: false, code: 'MCP_REAUTHENTICATION_REQUIRED' };
  const label = input.label.replace(/\s+/g, ' ').trim();
  if (!label || label.length > 100) return { ok: false, code: 'MCP_INVALID_NAME', field: 'label' };
  // Turning personal tokens off revokes them under the policy lock; creation waits for it.
  await tx.$queryRaw`SELECT id FROM "McpPolicy" WHERE id = 'default' FOR SHARE`;
  const policy: PatPolicy | null = await tx.mcpPolicy.findUnique({ where: { id: 'default' } });
  if (!policy?.enabled) return { ok: false, code: 'MCP_DISABLED' };
  if (!policy.patEnabled) return { ok: false, code: 'MCP_PAT_DISABLED' };
  // Serialise one person's creations so the per-person limit holds.
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actor.id} FOR UPDATE`;
  const user = await tx.user.findUnique({
    where: { id: actor.id },
    select: { status: true, role: true, tokenVersion: true, mcpRevocationVersion: true },
  });
  if (
    user?.status !== 'ACTIVE' ||
    user.tokenVersion !== actor.tokenVersion ||
    !isAppRole(user.role)
  )
    return { ok: false, code: 'MCP_INACTIVE_PRINCIPAL' };
  const choices = mcpPatScopeChoices(policy, user.role);
  const scopes = [...new Set(input.scopes)];
  if (!scopes.length || !scopes.every(scope => choices.includes(scope)))
    return { ok: false, code: 'MCP_INVALID_SCOPE', field: 'scopes' };
  if (
    !Number.isInteger(input.expiresInDays) ||
    input.expiresInDays < 1 ||
    input.expiresInDays > mcpPatMaxDays(policy)
  )
    return { ok: false, code: 'MCP_PAT_INVALID_EXPIRY', field: 'expiresInDays' };
  const now = new Date();
  // Tokens a security event already ended (sign-out everywhere, password change) do not count.
  const live = await tx.mcpGrant.count({
    where: {
      userId: actor.id,
      kind: 'PAT',
      revokedAt: null,
      expiresAt: { gt: now },
      userRevocationVersion: user.mcpRevocationVersion,
    },
  });
  if (live >= MCP_PAT_PER_USER_LIMIT) return { ok: false, code: 'MCP_PAT_LIMIT_REACHED' };
  await tx.mcpClient.upsert({
    where: { id: MCP_PAT_CLIENT_ID },
    create: { id: MCP_PAT_CLIENT_ID, name: 'Personal access token', redirectUris: [], scopes: [] },
    update: {},
  });
  const expiresAt = new Date(now.getTime() + input.expiresInDays * DAY_MS);
  const token = `${MCP_PAT_PREFIX}${randomBytes(32).toString('base64url')}`;
  const grant = await tx.mcpGrant.create({
    data: {
      kind: 'PAT',
      label,
      clientId: MCP_PAT_CLIENT_ID,
      userId: actor.id,
      userTokenVersion: user.tokenVersion,
      userRevocationVersion: user.mcpRevocationVersion,
      scopes,
      resource: mcpResource(),
      expiresAt,
      absoluteExpiresAt: expiresAt,
    },
    select: { id: true },
  });
  await tx.mcpToken.create({
    data: {
      grantId: grant.id,
      accessHash: digestMcpSecret(token),
      // The column is required; this digest is of a secret nobody holds, so it never refreshes.
      refreshHash: digestMcpSecret(`unrefreshable:${randomBytes(32).toString('base64url')}`),
      scopes,
      accessExpiresAt: expiresAt,
      refreshExpiresAt: expiresAt,
    },
  });
  await logAudit(
    {
      source: 'UI',
      action: 'mcp.pat.created',
      entityType: 'SYSTEM_CONFIG',
      entityId: grant.id,
      actorId: actor.id,
      details: { label, scopes, expiresAt: expiresAt.toISOString() },
    },
    tx
  );
  return { ok: true, token, grantId: grant.id, scopes, expiresAt };
}
