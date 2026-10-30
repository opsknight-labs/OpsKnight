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

const RESOURCE_LABEL = new Map(
  Object.entries({
    incidents: 'incidents',
    events: 'alert events',
    services: 'services',
    'service-objectives': 'service level objectives',
    schedules: 'on-call schedules',
    teams: 'teams',
    users: 'people',
    reports: 'reports and analytics',
    postmortems: 'postmortems',
    pages: 'status pages',
    'status-pages': 'status pages',
    'status-page-subscribers': 'status page subscribers',
    runbooks: 'runbooks',
    'runbook-rules': 'runbook trigger rules',
    'runbook-settings': 'runbook settings',
    rules: 'routing rules',
    policies: 'escalation policies',
    'escalation-policies': 'escalation policies',
    'response-policy': 'the response policy',
    integrations: 'integrations',
    notifications: 'notifications',
    fields: 'custom fields',
    'custom-fields': 'custom fields',
    chatops: 'ChatOps settings',
    automation: 'automation',
    'automation-settings': 'automation settings',
    audit: 'the audit log',
  })
);

/** The plain-language noun for a scope's resource, e.g. `schedules:read` → "on-call schedules". */
export function mcpScopeResourceLabel(scope: string) {
  const resource = scope.split(':')[0] || scope;
  return RESOURCE_LABEL.get(resource) ?? resource.replaceAll('_', ' ').replaceAll('-', ' ');
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Plain-language description of one scope, e.g. `incidents:read` → "View incidents". */
export function describeMcpScope(scope: string) {
  const action = scope.split(':')[1] ?? 'read';
  const label = mcpScopeResourceLabel(scope);
  if (action === 'read') return `View ${label}`;
  if (action === 'write')
    return `Propose changes to ${label} (an administrator must approve each one)`;
  if (action === 'execute') return `Run ${label} after administrator approval`;
  if (action === 'approve') return `Approve ${label} waiting for review`;
  if (action === 'activate') return `Turn ${label} on or off`;
  if (action === 'test') return `Send test messages through ${label}`;
  return capitalize(`${action.replaceAll('_', ' ')} ${label}`);
}
