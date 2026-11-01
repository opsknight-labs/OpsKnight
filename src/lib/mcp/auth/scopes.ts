import { MCP_CATALOG, isMcpApprovalGated, isMcpExecutable } from '@/lib/mcp/catalog';
import { MCP_REVIEWED_RUNBOOK_SCOPES } from '@/lib/mcp/approvals/policy';

/** Only scopes a reviewed direct or approval-gated workflow can use may ever be granted. */
export function supportedMcpScopes() {
  return new Set([
    ...MCP_CATALOG.filter(
      operation => isMcpExecutable(operation) || isMcpApprovalGated(operation)
    ).flatMap(operation => operation.requiredScopes),
    ...MCP_REVIEWED_RUNBOOK_SCOPES,
  ]);
}

export { describeMcpScope, mcpScopeResourceLabel } from './scope-labels';
