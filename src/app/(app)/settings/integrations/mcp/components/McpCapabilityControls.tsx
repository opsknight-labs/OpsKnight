import prisma from '@/lib/prisma';
import { getUserPermissions } from '@/lib/rbac';
import {
  MCP_CAPABILITIES,
  canonicalMcpCapabilityEntry,
  normalizeDisabledMcpCapabilities,
} from '@/lib/mcp/catalog/capabilities';
import { updateMcpDisabledCapabilities } from '../capability-actions';
import McpCapabilityControlsPanel from './McpCapabilityControlsPanel';

/**
 * "Exposed capabilities" section of the MCP settings page. Self-contained: it loads its own data,
 * renders nothing for non-administrators, and saves through its own audited server action.
 */
export default async function McpCapabilityControls(
  preloaded: { isAdmin: boolean; disabledCapabilities: string[] } | Record<string, never> = {}
) {
  // The settings page passes what it already read; standalone use loads it here.
  const isAdmin = 'isAdmin' in preloaded ? preloaded.isAdmin : (await getUserPermissions()).isAdmin;
  if (!isAdmin) return null;
  const policy =
    'disabledCapabilities' in preloaded
      ? { disabledCapabilities: preloaded.disabledCapabilities }
      : await prisma.mcpPolicy.findUnique({
          where: { id: 'default' },
          select: { disabledCapabilities: true },
        });
  // Stale entries (an operation removed from the catalog) are dropped from the editor and
  // ignored by enforcement; the next save removes them from storage.
  const disabled = normalizeDisabledMcpCapabilities(
    (policy?.disabledCapabilities ?? []).filter(
      entry => canonicalMcpCapabilityEntry(entry) !== null
    )
  );
  return (
    <McpCapabilityControlsPanel
      capabilities={MCP_CAPABILITIES.map(capability => ({ ...capability }))}
      initialDisabled={disabled}
      action={updateMcpDisabledCapabilities}
    />
  );
}
