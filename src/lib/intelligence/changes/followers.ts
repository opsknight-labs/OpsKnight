import 'server-only';
import prisma from '@/lib/prisma';
import { incidentReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { RESPONSE_LIMITS } from '../contract';
import { loadActiveEdges } from '../dependencies/service';
import { downstreamDistances } from '../dependencies/graph';
import { getIntelligenceSettings } from '../settings/service';

export const FOLLOW_WINDOW_MINUTES = 120;
const MAX_FOLLOWERS = 20;

export interface ChangeFollowers {
  riskScore: number | null;
  incidents: Array<{
    id: string;
    title: string;
    status: string;
    minutesAfter: number;
    service: { id: string; name: string };
    /** Opened on a service that depends on the changed one, not on the changed service itself. */
    dependant: boolean;
  }>;
}

/**
 * Incidents the viewer may open that started within FOLLOW_WINDOW_MINUTES after a change, on its service or a
 * service depending on it. Timing only, never a verdict. Null while the helpers switch is off or the change
 * has no service. Bounded: the active edge list and at most MAX_FOLLOWERS incidents.
 */
export async function getChangeFollowers(
  actor: AuthorizationActor,
  changeId: string
): Promise<ChangeFollowers | null> {
  const settings = await getIntelligenceSettings();
  if (!settings.enabled || !settings.opsHelpersEnabled) return null;
  const change = await prisma.changeEvent.findUnique({
    where: { id: changeId },
    select: { serviceId: true, occurredAt: true, riskScore: true },
  });
  if (!change?.serviceId) return null;
  const dependants = downstreamDistances(
    await loadActiveEdges(),
    change.serviceId,
    RESPONSE_LIMITS.maxUpstreamDepth
  ).distances;
  const start = change.occurredAt.getTime();
  const rows = await prisma.incident.findMany({
    where: {
      AND: [
        {
          serviceId: { in: [change.serviceId, ...dependants.keys()] },
          createdAt: {
            gte: change.occurredAt,
            lte: new Date(start + FOLLOW_WINDOW_MINUTES * 60_000),
          },
        },
        incidentReadWhere(actor),
      ],
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: MAX_FOLLOWERS,
    select: {
      id: true,
      title: true,
      status: true,
      createdAt: true,
      service: { select: { id: true, name: true } },
    },
  });
  return {
    riskScore: change.riskScore,
    incidents: rows.map(row => ({
      id: row.id,
      title: row.title,
      status: row.status,
      minutesAfter: Math.round((row.createdAt.getTime() - start) / 60_000),
      service: row.service,
      dependant: row.service.id !== change.serviceId,
    })),
  };
}
