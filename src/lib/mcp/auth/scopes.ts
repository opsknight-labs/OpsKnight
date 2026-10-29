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

const RESOURCE_LABEL: Record<string, string> = {
  incidents: 'incidents',
  services: 'services',
  schedules: 'on-call schedules',
  teams: 'teams',
  reports: 'reports and analytics',
  postmortems: 'postmortems',
  pages: 'status pages',
  runbooks: 'runbooks',
  rules: 'routing rules',
  policies: 'escalation policies',
  integrations: 'integrations',
  fields: 'custom fields',
  automation: 'automation',
};

/** Plain-language description of one scope, e.g. `incidents:read` → "View incidents". */
export function describeMcpScope(scope: string) {
  const [resource = scope, action = 'read'] = scope.split(':');
  const label = RESOURCE_LABEL[resource] ?? resource.replaceAll('_', ' ');
  if (action === 'read') return `View ${label}`;
  if (action === 'write')
    return `Propose changes to ${label} (an administrator must approve each one)`;
  if (action === 'execute') return `Run ${label} after administrator approval`;
  return `${action.replaceAll('_', ' ')} ${label}`;
}
