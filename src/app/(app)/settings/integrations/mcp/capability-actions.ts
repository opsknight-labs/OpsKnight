'use server';

import { z } from 'zod/v3';
import { Prisma, Role } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { getCurrentUser, getUserPermissions } from '@/lib/rbac';
import { requireMcp } from '@/lib/mcp/core/errors';
import { requireFreshMcpAdmin } from '@/lib/mcp/auth/fresh-admin';
import { MCP_REAUTHENTICATION_REQUIRED, capabilitiesWiden } from '@/lib/mcp/auth/policy-widening';
import {
  InvalidMcpCapabilityError,
  MAX_DISABLED_CAPABILITY_ENTRIES,
  canonicalMcpCapabilityEntry,
  normalizeDisabledMcpCapabilities,
} from '@/lib/mcp/catalog/capabilities';
import { MCP_ROLES, roleDisabledMcpCapabilities } from '@/lib/mcp/auth/effective-capabilities';
import { MCP_PAT_CLIENT_ID } from '@/lib/mcp/auth/effective-access';

const settingsPath = '/settings/integrations/mcp';

const entry = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9_:.-]+$/);

const inputSchema = z
  .object({
    /** The complete list of disabled capability ids and `domain:<name>` markers to store. */
    disabled: z.array(entry).max(MAX_DISABLED_CAPABILITY_ENTRIES),
    /** The list the editor started from; a different stored list means someone else saved. */
    baseline: z.array(entry).max(MAX_DISABLED_CAPABILITY_ENTRIES),
    /** Whose list this is. Omitted: the global list that applies to everyone. */
    scope: z
      .discriminatedUnion('kind', [
        z.object({ kind: z.literal('global') }).strict(),
        z.object({ kind: z.literal('role'), role: z.nativeEnum(Role) }).strict(),
        z.object({ kind: z.literal('client'), clientId: z.string().min(1).max(256) }).strict(),
      ])
      .default({ kind: 'global' }),
  })
  .strict();

export type UpdateMcpDisabledCapabilitiesInput = z.input<typeof inputSchema>;
export type McpCapabilityScope = UpdateMcpDisabledCapabilitiesInput['scope'];

export type UpdateMcpCapabilitiesResult =
  | { ok: true; disabled: string[]; added: string[]; removed: string[] }
  | { ok: false; code: 'MCP_INVALID_CAPABILITY'; invalid: string[] }
  | { ok: false; code: 'MCP_POLICY_CONFLICT'; disabled: string[] }
  | { ok: false; code: typeof MCP_REAUTHENTICATION_REQUIRED }
  | { ok: false; code: 'MCP_CLIENT_NOT_FOUND' };

/** The stored list with stale entries dropped, so it can be compared and re-saved safely. */
function knownEntries(stored: readonly string[]) {
  return normalizeDisabledMcpCapabilities(
    stored.filter(item => canonicalMcpCapabilityEntry(item) !== null)
  );
}

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((item, index) => item === b.at(index));

/**
 * Replace the administrator-disabled MCP capabilities of one scope: everyone (global), one role,
 * or one assistant. The scopes combine as a union (effective-capabilities.ts). Admin only,
 * validated against the real tool and catalog lists, optimistic against concurrent edits per
 * scope, and audited with the scope and the exact diff.
 * Takes effect on the next MCP request of every session: policy is read per request, never cached.
 */
export async function updateMcpDisabledCapabilities(
  raw: unknown
): Promise<UpdateMcpCapabilitiesResult> {
  const permissions = await getUserPermissions();
  requireMcp(permissions.capabilities.includes('admin.manage'), 'MCP_ADMIN_REQUIRED', 403);
  const user = await getCurrentUser();
  const input = inputSchema.parse(raw);
  const { scope } = input;
  let disabled: string[];
  let baseline: string[];
  try {
    disabled = normalizeDisabledMcpCapabilities(input.disabled);
    baseline = knownEntries(input.baseline);
  } catch (error) {
    if (error instanceof InvalidMcpCapabilityError)
      return { ok: false, code: 'MCP_INVALID_CAPABILITY', invalid: error.entries };
    throw error;
  }
  const result = await prisma.$transaction(async (tx): Promise<UpdateMcpCapabilitiesResult> => {
    // The acting administrator must still be a current, active administrator.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${permissions.id} FOR SHARE`;
    const current = await tx.user.findUnique({
      where: { id: permissions.id },
      select: { role: true, status: true, tokenVersion: true },
    });
    requireMcp(
      current?.role === 'ADMIN' &&
        current.status === 'ACTIVE' &&
        current.tokenVersion === user.tokenVersion,
      'MCP_ADMIN_REQUIRED',
      403
    );
    // Serialise with other policy writers and with MCP mutations that hold the row FOR SHARE.
    await tx.$executeRaw`INSERT INTO "McpPolicy" (id, "updatedAt") VALUES ('default', NOW())
      ON CONFLICT (id) DO NOTHING`;
    await tx.$queryRaw`SELECT id FROM "McpPolicy" WHERE id = 'default' FOR UPDATE`;
    const policy = await tx.mcpPolicy.findUniqueOrThrow({
      where: { id: 'default' },
      select: { disabledCapabilities: true, roleDisabledCapabilities: true },
    });
    // The list this scope enforces today (an unreadable role entry is shown as what it enforces).
    let storedValue: unknown;
    let label = 'all roles';
    if (scope.kind === 'role') {
      storedValue = policy.roleDisabledCapabilities;
      label = `role ${scope.role}`;
    } else if (scope.kind === 'client') {
      // Locks out MCP mutations of this assistant (they hold the row FOR SHARE) while it changes.
      await tx.$queryRaw`SELECT id FROM "McpClient" WHERE id = ${scope.clientId} FOR UPDATE`;
      const client = await tx.mcpClient.findUnique({
        where: { id: scope.clientId },
        select: { name: true, disabledCapabilities: true },
      });
      // Personal access tokens share one internal client; it is not an assistant to restrict.
      if (!client || scope.clientId === MCP_PAT_CLIENT_ID)
        return { ok: false, code: 'MCP_CLIENT_NOT_FOUND' };
      storedValue = client.disabledCapabilities;
      label = `assistant ${client.name}`;
    } else storedValue = policy.disabledCapabilities;
    const enforced =
      scope.kind === 'role'
        ? roleDisabledMcpCapabilities(storedValue, scope.role)
        : (storedValue as string[]);
    const stored = knownEntries(enforced);
    if (!sameList(stored, baseline))
      return { ok: false, code: 'MCP_POLICY_CONFLICT', disabled: stored };
    // Re-exposing a capability widens access and needs a recent sign-in; hiding one never does.
    if (capabilitiesWiden(stored, disabled) && !(await requireFreshMcpAdmin(permissions.id)))
      return { ok: false, code: MCP_REAUTHENTICATION_REQUIRED };
    const added = disabled.filter(item => !stored.includes(item));
    const removed = stored.filter(item => !disabled.includes(item));
    // Every role is rewritten in its saved shape, each keeping exactly what it enforces now.
    const byRole =
      scope.kind === 'role'
        ? Object.fromEntries(
            MCP_ROLES.map(role => [
              role,
              role === scope.role
                ? disabled
                : knownEntries(roleDisabledMcpCapabilities(storedValue, role)),
            ]).filter(([, list]) => list.length)
          )
        : null;
    const unchanged =
      scope.kind === 'role'
        ? JSON.stringify(storedValue ?? {}) === JSON.stringify(byRole)
        : sameList(enforced, disabled);
    if (!added.length && !removed.length && unchanged)
      return { ok: true, disabled, added, removed };
    if (scope.kind === 'client')
      await tx.mcpClient.update({
        where: { id: scope.clientId },
        data: { disabledCapabilities: disabled },
      });
    else
      await tx.mcpPolicy.update({
        where: { id: 'default' },
        data:
          scope.kind === 'role'
            ? {
                roleDisabledCapabilities: Object.keys(byRole!).length ? byRole! : Prisma.DbNull,
              }
            : { disabledCapabilities: disabled },
      });
    await logAudit(
      {
        source: 'UI',
        action: 'mcp.policy.capabilities_updated',
        entityType: 'SYSTEM_CONFIG',
        entityId: scope.kind === 'client' ? scope.clientId : 'mcp-policy',
        actorId: permissions.id,
        details: { scope: label, added, removed, disabledCount: disabled.length },
        oldValue: { scope: label, disabledCapabilities: stored },
        newValue: { scope: label, disabledCapabilities: disabled },
      },
      tx
    );
    return { ok: true, disabled, added, removed };
  });
  if (result.ok) revalidatePath(settingsPath);
  return result;
}
