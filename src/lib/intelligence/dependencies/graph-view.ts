import 'server-only';
import prisma from '@/lib/prisma';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { incidentReadWhere, serviceReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { MAX_DEPENDENCIES } from './service';

export interface GraphNode {
  id: string;
  name: string;
  teamName: string | null;
  openIncidents: number;
  highestOpenUrgency: 'HIGH' | 'MEDIUM' | 'LOW' | null;
}

export interface GraphEdge {
  upstreamServiceId: string;
  downstreamServiceId: string;
  origin: 'DECLARED' | 'OBSERVED';
  status: 'ACTIVE' | 'SUGGESTED';
  confidence: number;
}

export interface ServiceGraphView {
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
}

const MAX_NODES = 2000;
const urgencyRank = (urgency: 'HIGH' | 'MEDIUM' | 'LOW') =>
  urgency === 'HIGH' ? 2 : urgency === 'MEDIUM' ? 1 : 0;

/**
 * The service graph with a live incident overlay, restricted to the services and incidents the actor
 * may read. Edges touching a service the actor cannot see are dropped, so the graph never reveals a
 * dependency on something hidden from them.
 */
export async function getServiceGraphForActor(
  actor: AuthorizationActor,
  client: typeof prisma = prisma
): Promise<ServiceGraphView | null> {
  if (!hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_READ)) return null;
  let services: ReturnType<typeof serviceReadWhere>;
  let incidents: ReturnType<typeof incidentReadWhere>;
  try {
    services = serviceReadWhere(actor);
    incidents = incidentReadWhere(actor);
  } catch {
    return null;
  }
  const rows = await client.service.findMany({
    where: services,
    orderBy: { name: 'asc' },
    take: MAX_NODES + 1,
    select: { id: true, name: true, team: { select: { name: true } } },
  });
  const truncated = rows.length > MAX_NODES;
  const visible = rows.slice(0, MAX_NODES);
  const ids = new Set(visible.map(row => row.id));
  const [open, edges] = await Promise.all([
    client.incident.groupBy({
      by: ['serviceId', 'urgency'],
      where: {
        AND: [{ serviceId: { in: [...ids] }, status: { in: ['OPEN', 'ACKNOWLEDGED'] } }, incidents],
      },
      _count: { _all: true },
    }),
    client.serviceDependency.findMany({
      where: {
        status: { in: ['ACTIVE', 'SUGGESTED'] },
        upstreamServiceId: { in: [...ids] },
        downstreamServiceId: { in: [...ids] },
      },
      take: MAX_DEPENDENCIES,
      select: {
        upstreamServiceId: true,
        downstreamServiceId: true,
        origin: true,
        status: true,
        confidence: true,
      },
    }),
  ]);
  const overlay = new Map<string, { count: number; urgency: GraphNode['highestOpenUrgency'] }>();
  for (const row of open) {
    const entry = overlay.get(row.serviceId) ?? { count: 0, urgency: null };
    entry.count += row._count._all;
    const urgency = row.urgency as 'HIGH' | 'MEDIUM' | 'LOW';
    if (!entry.urgency || urgencyRank(urgency) > urgencyRank(entry.urgency))
      entry.urgency = urgency;
    overlay.set(row.serviceId, entry);
  }
  return {
    nodes: visible.map(row => ({
      id: row.id,
      name: row.name,
      teamName: row.team?.name ?? null,
      openIncidents: overlay.get(row.id)?.count ?? 0,
      highestOpenUrgency: overlay.get(row.id)?.urgency ?? null,
    })),
    edges: edges.map(edge => ({
      ...edge,
      status: edge.status === 'ACTIVE' ? 'ACTIVE' : 'SUGGESTED',
    })),
    truncated,
  };
}
