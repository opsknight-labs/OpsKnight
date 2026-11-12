import { Prisma, Role } from '@prisma/client';
import prisma from '@/lib/prisma';
import { MCP_CAPABILITY_DOMAINS, MCP_DOMAIN_PREFIX } from '../catalog/capabilities';

/**
 * What an assistant may not use for one person: the global list, the list for the person's
 * current role and the list for the assistant (MCP client) they are using, combined as a union.
 * Each layer can only narrow; none can re-enable what another disabled.
 *
 * Every place that lists or runs a capability for a principal reads this one result, so tools/list
 * and execution always agree. Entries are returned as stored (ids, tool aliases, `domain:` markers);
 * resolveDisabledMcpCapabilities expands them and ignores stale ids.
 */
export interface McpCapabilityRestrictionSource {
  disabledCapabilities?: readonly string[] | null;
  /** McpPolicy.roleDisabledCapabilities: `{ "<Role>": string[] }`, validated only on save. */
  roleDisabledCapabilities?: unknown;
  clientDisabledCapabilities?: readonly string[] | null;
}

export const MCP_ROLES = Object.values(Role);

/** Every capability, as domain markers: what an unreadable role restriction stands for. */
const EVERYTHING = MCP_CAPABILITY_DOMAINS.map(domain => `${MCP_DOMAIN_PREFIX}${domain}`);

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(entry => typeof entry === 'string');

/**
 * The stored restriction for one role. A missing value restricts nothing. A value that is not the
 * saved shape (edited by hand in the database) fails closed and disables everything for that role,
 * except for ADMIN: administrators keep their access, so a bad row can never take MCP away from the
 * people who can see and fix it.
 */
export function roleDisabledMcpCapabilities(byRole: unknown, role: string | null | undefined) {
  if (byRole === null || byRole === undefined || !role) return [];
  if (typeof byRole === 'object' && !Array.isArray(byRole)) {
    const value = new Map(Object.entries(byRole)).get(role) ?? [];
    if (isStringList(value)) return value;
  }
  return role === Role.ADMIN ? [] : EVERYTHING;
}

export function effectiveDisabledMcpCapabilities(
  source: McpCapabilityRestrictionSource,
  role: string | null | undefined
): string[] {
  return [
    ...new Set([
      ...(source.disabledCapabilities ?? []),
      ...roleDisabledMcpCapabilities(source.roleDisabledCapabilities, role),
      ...(source.clientDisabledCapabilities ?? []),
    ]),
  ];
}

/**
 * The effective list for a grant, read in one statement. For paths that check a capability
 * without the principal snapshot (principal.ts reads the same columns with the grant). An unknown
 * grant yields the global list only.
 */
export async function loadEffectiveDisabledMcpCapabilities(
  grantId: string,
  db: Prisma.TransactionClient = prisma
) {
  const [row] = await db.$queryRaw<(McpCapabilityRestrictionSource & { role: string | null })[]>`
    SELECT p."disabledCapabilities", p."roleDisabledCapabilities",
      c."disabledCapabilities" AS "clientDisabledCapabilities", u.role::text AS role
    FROM "McpPolicy" p
    LEFT JOIN "McpGrant" g ON g.id = ${grantId}
    LEFT JOIN "McpClient" c ON c.id = g."clientId"
    LEFT JOIN "User" u ON u.id = g."userId"
    WHERE p.id = 'default'`;
  return row ? effectiveDisabledMcpCapabilities(row, row.role) : [];
}
