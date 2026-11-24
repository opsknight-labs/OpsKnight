import { getCurrentUser } from '@/lib/rbac';
import { leaveIncidentViewer } from '@/lib/incidents/presence';

const ID = /^[A-Za-z0-9_-]{1,191}$/;

/**
 * "I closed this incident": a navigator.sendBeacon target, because a server action started during pagehide is
 * usually cancelled. Removes only the caller's own entry, so no incident check; always 204 (beacons ignore replies).
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (ID.test(id)) {
    const user = await getCurrentUser().catch(() => null);
    if (user) leaveIncidentViewer(id, user.id);
  }
  return new Response(null, { status: 204 });
}
