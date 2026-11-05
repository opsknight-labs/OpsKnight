/**
 * Where an in-app notification opens, from its stored entity. Incidents keep their own
 * `incidentId` field for older clients; this covers everything else that has a page.
 */
export function inAppNotificationHref(notification: {
  entityType: string | null;
  entityId: string | null;
}): string | null {
  const { entityType, entityId } = notification;
  // Non-incident notifications that need an administrator's action open its screen.
  if (entityType === 'SSO_LINK_REQUEST')
    return '/settings/system?section=sso&authTab=access&linking=requested';
  if (!entityId) return null;
  if (entityType === 'MCP_APPROVAL') {
    // Operation approvals are cuids; runbook previews are 64-character hex digests.
    if (/^[a-f0-9]{64}$/.test(entityId)) return `/settings/integrations/mcp/approvals/${entityId}`;
    if (/^c[a-z0-9]{20,40}$/.test(entityId))
      return `/settings/integrations/mcp/approvals/operations/${entityId}`;
    return null;
  }
  return null;
}
