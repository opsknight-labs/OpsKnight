'use server';

import { z } from 'zod/v3';
import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { getCurrentUser, getUserPermissions } from '@/lib/rbac';
import { requireMcp } from '@/lib/mcp/core/errors';
import {
  InvalidMcpCapabilityError,
  MAX_DISABLED_CAPABILITY_ENTRIES,
  canonicalMcpCapabilityEntry,
  normalizeDisabledMcpCapabilities,
} from '@/lib/mcp/catalog/capabilities';

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
  })
  .strict();

export type UpdateMcpCapabilitiesResult =
  | { ok: true; disabled: string[]; added: string[]; removed: string[] }
  | { ok: false; code: 'MCP_INVALID_CAPABILITY'; invalid: string[] }
  | { ok: false; code: 'MCP_POLICY_CONFLICT'; disabled: string[] };

/** The stored list with stale entries dropped, so it can be compared and re-saved safely. */
function knownEntries(stored: readonly string[]) {
  return normalizeDisabledMcpCapabilities(
    stored.filter(item => canonicalMcpCapabilityEntry(item) !== null)
  );
}

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((item, index) => item === b.at(index));

/**
 * Replace the administrator-disabled MCP capabilities. Admin only, validated against the real
 * tool and catalog lists, optimistic against concurrent edits, and audited with the exact diff.
 * Takes effect on the next MCP request of every session: policy is read per request, never cached.
 */
export async function updateMcpDisabledCapabilities(
  raw: unknown
): Promise<UpdateMcpCapabilitiesResult> {
  const permissions = await getUserPermissions();
  requireMcp(permissions.capabilities.includes('admin.manage'), 'MCP_ADMIN_REQUIRED', 403);
  const user = await getCurrentUser();
  const input = inputSchema.parse(raw);
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
      select: { disabledCapabilities: true },
    });
    const stored = knownEntries(policy.disabledCapabilities);
    if (!sameList(stored, baseline))
      return { ok: false, code: 'MCP_POLICY_CONFLICT', disabled: stored };
    const added = disabled.filter(item => !stored.includes(item));
    const removed = stored.filter(item => !disabled.includes(item));
    if (!added.length && !removed.length && sameList(policy.disabledCapabilities, disabled))
      return { ok: true, disabled, added, removed };
    await tx.mcpPolicy.update({
      where: { id: 'default' },
      data: { disabledCapabilities: disabled },
    });
    await logAudit(
      {
        source: 'UI',
        action: 'mcp.policy.capabilities_updated',
        entityType: 'SYSTEM_CONFIG',
        entityId: 'mcp-policy',
        actorId: permissions.id,
        details: { added, removed, disabledCount: disabled.length },
        oldValue: { disabledCapabilities: stored },
        newValue: { disabledCapabilities: disabled },
      },
      tx
    );
    return { ok: true, disabled, added, removed };
  });
  if (result.ok) revalidatePath(settingsPath);
  return result;
}
