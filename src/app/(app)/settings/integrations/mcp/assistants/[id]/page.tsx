import { notFound } from 'next/navigation';
import McpAssistantDetail from '@/components/settings/mcp/McpAssistantDetail';
import { personLabel } from '@/components/settings/mcp/sections/McpConnectionsSection';
import { describeMcpScope } from '@/lib/mcp/auth/scopes';
import { revokeMcpAccess, restoreMcpClient } from '../../actions';
import { loadMcpConnectionActivity } from '../../activity-actions';
import { listMcpClientRecentCalls } from '../../activity';
import { USAGE_WINDOW_KEYS } from '../../list-params';
import { getMcpClient, listMcpGrants, loadMcpPagePermissions, loadMcpViewer } from '../../queries';
import { getMcpUsage } from '../../usage';

export const dynamic = 'force-dynamic';

// Metadata clients' ids are URLs, so links percent-encode them into one path segment.
function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** One assistant, for administrators. Everyone else, and unknown ids, get "not found". */
export default async function McpAssistantPage({ params }: { params: Promise<{ id: string }> }) {
  const permissions = await loadMcpPagePermissions();
  if (!permissions.authenticated || !permissions.isAdmin) notFound();
  const viewer = await loadMcpViewer(permissions);
  const id = safeDecode((await params).id);
  const now = new Date();
  const client = await getMcpClient(viewer, id, now);
  if (!client) notFound();

  const [connections, usage, calls] = await Promise.all([
    listMcpGrants(viewer, { status: 'all', q: '', clientId: client.id, page: 1 }, now),
    Promise.all(
      USAGE_WINDOW_KEYS.map(window =>
        getMcpUsage(viewer, { window, by: 'tool', clientId: client.id }, now)
      )
    ),
    listMcpClientRecentCalls(viewer, client.id),
  ]);
  const people = new Map(connections.rows.map(row => [row.user.id, personLabel(row.user)]));

  return (
    <McpAssistantDetail
      client={client}
      connections={connections.rows}
      connectionsTotal={connections.counts.all}
      usage={usage}
      calls={calls.map(call => ({
        ...call,
        person: call.userId ? (people.get(call.userId) ?? null) : null,
      }))}
      now={now}
      timeZone={viewer.timeZone}
      describeScope={describeMcpScope}
      revokeAction={revokeMcpAccess}
      restoreAction={restoreMcpClient}
      activityAction={loadMcpConnectionActivity}
    />
  );
}
