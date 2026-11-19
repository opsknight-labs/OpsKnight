/**
 * Where an in-app notification opens, from its stored entity. Incidents keep their own
 * `incidentId` field for older clients; this covers everything else that has a page.
 */
export type InAppNotificationKind = 'incident' | 'service' | 'schedule' | 'system';

const NOTIFICATION_KINDS = new Map<string, InAppNotificationKind>([
  ['incident', 'incident'],
  ['schedule', 'schedule'],
  ['service', 'service'],
  ['team', 'service'],
  ['system', 'system'],
  // Security notices (access requests, emergency access, SSO) are not incidents.
  ['security', 'system'],
  ['action_item', 'system'],
]);

/** Display category for an in-app notification type. Unknown types never pose as incidents. */
export function inAppNotificationKind(type: string): InAppNotificationKind {
  return NOTIFICATION_KINDS.get(type.toLowerCase()) ?? 'system';
}

export function inAppNotificationHref(notification: {
  entityType: string | null;
  entityId: string | null;
}): string | null {
  const { entityType, entityId } = notification;
  // Non-incident notifications that need an administrator's action open its screen.
  if (entityType === 'SSO_LINK_REQUEST')
    return '/settings/system?section=sso&authTab=access&linking=requested';
  // Access control: approvers land on the request so they can approve or decline it there;
  // requesters and holders land on their own access page.
  if (entityType === 'ACCESS_REQUEST')
    return entityId
      ? `/settings/access/requests?request=${encodeURIComponent(entityId)}#request-${encodeURIComponent(entityId)}`
      : '/settings/access/requests';
  if (entityType === 'ACCESS_REQUEST_DECIDED' || entityType === 'ACCESS_GRANT_ENDED')
    return '/settings/access';
  if (entityType === 'ACCESS_GRANT') return '/settings/access/admin#temporary-access';
  if (entityType === 'ACCESS_REVIEW') return '/settings/access/admin#access-reviews';
  if (!entityId) return null;
  // A personal access token about to expire: its owner's connections list.
  if (entityType === 'MCP_PERSONAL_TOKEN') return '/settings/integrations/mcp?tab=connections';
  if (entityType === 'MCP_APPROVAL') {
    // Operation approvals are cuids; runbook previews are 64-character hex digests.
    if (/^[a-f0-9]{64}$/.test(entityId)) return `/settings/integrations/mcp/approvals/${entityId}`;
    if (/^c[a-z0-9]{20,40}$/.test(entityId))
      return `/settings/integrations/mcp/approvals/operations/${entityId}`;
    return null;
  }
  return null;
}
