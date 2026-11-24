'use server';

import { z } from 'zod/v3';
import { assertCanViewIncident } from '@/lib/rbac';
import { heartbeatIncidentViewer, type PresenceViewer } from '@/lib/incidents/presence';

const incidentIdSchema = z.string().trim().min(1).max(191);

/** Marks the caller as viewing the incident and returns everyone viewing it (caller included). */
export async function heartbeatIncidentPresence(incidentId: string): Promise<PresenceViewer[]> {
  const id = incidentIdSchema.parse(incidentId);
  // The only database work: the per-request session and incident-read check every action already does.
  const user = await assertCanViewIncident(id);
  return heartbeatIncidentViewer(id, {
    id: user.id,
    name: user.name ?? null,
    avatarUrl: user.avatarUrl ?? null,
  });
}
