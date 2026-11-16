import prisma from '@/lib/prisma';
import { getUserPermissions } from '@/lib/rbac';
import {
  MCP_CAPABILITIES,
  canonicalMcpCapabilityEntry,
  normalizeDisabledMcpCapabilities,
} from '@/lib/mcp/catalog/capabilities';
import { MCP_ROLES, roleDisabledMcpCapabilities } from '@/lib/mcp/auth/effective-capabilities';
import { MCP_PAT_CLIENT_ID } from '@/lib/mcp/auth/effective-access';
import { updateMcpDisabledCapabilities } from '../capability-actions';
import McpCapabilityScopedControls, {
  type McpCapabilityScopeOption,
} from './McpCapabilityScopedControls';

// shortcut: lists the first 500 assistants by name; add search when deployments register more.
const MAX_ASSISTANTS = 500;

// Stale entries (an operation removed from the catalog) are dropped from the editor and
// ignored by enforcement; the next save removes them from storage.
const known = (entries: readonly string[]) =>
  normalizeDisabledMcpCapabilities(
    entries.filter(entry => canonicalMcpCapabilityEntry(entry) !== null)
  );

/**
 * "Exposed capabilities" section of the MCP settings page. Self-contained: it loads its own data,
 * renders nothing for non-administrators, and saves through its own audited server action.
 */
export default async function McpCapabilityControls(
  preloaded:
    | { isAdmin: boolean; disabledCapabilities: string[]; roleDisabledCapabilities?: unknown }
    | Record<string, never> = {}
) {
  // The settings page passes what it already read; standalone use loads it here.
  const isAdmin = 'isAdmin' in preloaded ? preloaded.isAdmin : (await getUserPermissions()).isAdmin;
  if (!isAdmin) return null;
  const policy =
    'disabledCapabilities' in preloaded
      ? preloaded
      : await prisma.mcpPolicy.findUnique({
          where: { id: 'default' },
          select: { disabledCapabilities: true, roleDisabledCapabilities: true },
        });
  const clients = await prisma.mcpClient.findMany({
    where: { id: { not: MCP_PAT_CLIENT_ID } },
    select: { id: true, name: true, revokedAt: true, disabledCapabilities: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: MAX_ASSISTANTS,
  });
  const scopes: McpCapabilityScopeOption[] = [
    {
      value: 'global',
      label: 'All roles',
      scope: { kind: 'global' },
      disabled: known(policy?.disabledCapabilities ?? []),
    },
    ...MCP_ROLES.map(role => ({
      value: `role:${role}`,
      label: role.charAt(0) + role.slice(1).toLowerCase(),
      scope: { kind: 'role' as const, role },
      // What the role enforces, so an unreadable stored entry shows as fully restricted.
      disabled: known(roleDisabledMcpCapabilities(policy?.roleDisabledCapabilities, role)),
    })),
    ...clients.map(client => ({
      value: `client:${client.id}`,
      label: client.revokedAt ? `${client.name} (revoked)` : client.name,
      scope: { kind: 'client' as const, clientId: client.id },
      disabled: known(client.disabledCapabilities),
    })),
  ];
  return (
    <McpCapabilityScopedControls
      capabilities={MCP_CAPABILITIES.map(capability => ({ ...capability }))}
      scopes={scopes}
      action={updateMcpDisabledCapabilities}
    />
  );
}
