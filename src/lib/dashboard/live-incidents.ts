import 'server-only';

import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { incidentReadWhere } from '@/lib/authorization-filters';
import { visibleIncidentSource } from '@/lib/automation/presentation/source-visibility';
import {
  LIVE_ACTIVE_STATUSES,
  LIVE_INCIDENT_DEFAULT_LIMIT,
  LIVE_INCIDENT_MAX_LIMIT,
  DEFAULT_LIVE_INCIDENT_QUERY,
  type LiveIncident,
  type LiveIncidentFeed,
  type LiveIncidentFilter,
} from './live-incidents-shared';

const liveIncidentSelect = {
  id: true,
  title: true,
  automationSourceRestricted: true,
  automationDecision: { select: { incidentId: true } },
  automationTraces: { select: { incidentId: true }, take: 1 },
  status: true,
  urgency: true,
  priority: true,
  createdAt: true,
  updatedAt: true,
  service: { select: { id: true, name: true } },
  team: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true, email: true } },
} satisfies Prisma.IncidentSelect;

export function liveIncidentFilterWhere(
  actor: AuthorizationActor,
  filter: LiveIncidentFilter
): Prisma.IncidentWhereInput {
  switch (filter) {
    case 'critical':
      return { OR: [{ urgency: 'HIGH' }, { priority: 'P1' }] };
    case 'mine':
      return { assigneeId: actor.id };
    case 'my_teams': {
      const teamIds = [...actor.teamIds];
      // An actor without teams has no team-owned incidents; never widen to "everything".
      if (teamIds.length === 0) return { id: { in: [] } };
      return { OR: [{ teamId: { in: teamIds } }, { service: { teamId: { in: teamIds } } }] };
    }
    case 'active':
    default:
      return {};
  }
}

/**
 * Authoritative, authorization-scoped read path for the dashboard live feed.
 * Realtime events only invalidate this projection; they are never trusted as
 * the active-incident snapshot themselves.
 */
export async function getLiveIncidentFeed(
  actor: AuthorizationActor,
  filter: LiveIncidentFilter,
  options: { limit?: number; generation?: string | null } = {}
): Promise<LiveIncidentFeed> {
  const limit = Math.min(
    Math.max(1, Math.floor(options.limit ?? LIVE_INCIDENT_DEFAULT_LIMIT)),
    LIVE_INCIDENT_MAX_LIMIT
  );
  const where: Prisma.IncidentWhereInput = {
    AND: [
      incidentReadWhere(actor),
      { status: { in: [...LIVE_ACTIVE_STATUSES] } },
      liveIncidentFilterWhere(actor, filter),
    ],
  };
  const sensitive = hasCapability(actor.role, CAPABILITIES.INCIDENT_SENSITIVE_READ);
  const [rows, total] = await Promise.all([
    prisma.incident.findMany({
      where,
      select: liveIncidentSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    }),
    prisma.incident.count({ where }),
  ]);

  return {
    query: { ...DEFAULT_LIVE_INCIDENT_QUERY, filter },
    filter,
    total,
    asOf: new Date().toISOString(),
    generation: options.generation ?? null,
    incidents: rows.map((row): LiveIncident => {
      const visible = visibleIncidentSource(row, sensitive);
      return {
        id: visible.id,
        title: visible.title,
        status: visible.status as LiveIncident['status'],
        urgency: visible.urgency,
        priority: visible.priority,
        createdAt: visible.createdAt.toISOString(),
        updatedAt: visible.updatedAt.toISOString(),
        service: { id: visible.service.id, name: visible.service.name },
        team: visible.team ? { id: visible.team.id, name: visible.team.name } : null,
        assignee: visible.assignee
          ? { id: visible.assignee.id, name: visible.assignee.name || visible.assignee.email }
          : null,
      };
    }),
  };
}
