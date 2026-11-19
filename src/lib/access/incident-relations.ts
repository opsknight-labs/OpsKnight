import 'server-only';

import prisma from '@/lib/prisma';
import { getActiveOnCallShifts } from '@/lib/oncall-shifts';
import { CAPABILITIES } from '@/lib/authorization';
import {
  actorHasCapability,
  incidentOperatorRelation,
  type AuthorizationActor,
  type AuthorizationResource,
} from '@/lib/authorization-policy';

export type IncidentAccessResource = Extract<AuthorizationResource, { type: 'incident' }>;

export async function loadIncidentAccessResource(
  incidentId: string
): Promise<(IncidentAccessResource & { escalationPolicyId: string | null }) | null> {
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    select: {
      id: true,
      assigneeId: true,
      teamId: true,
      visibility: true,
      watchers: { select: { userId: true } },
      service: { select: { teamId: true, escalationPolicyId: true } },
    },
  });
  if (!incident) return null;
  return {
    type: 'incident',
    id: incident.id,
    assigneeId: incident.assigneeId,
    assignedTeamId: incident.teamId,
    visibility: incident.visibility,
    watcherIds: (incident.watchers ?? []).map(watcher => watcher.userId),
    serviceTeamId: incident.service?.teamId ?? null,
    escalationPolicyId: incident.service?.escalationPolicyId ?? null,
  };
}

/**
 * Whether `userId` is someone this incident pages: a direct escalation target, a member of a
 * target team, or currently on shift in a target schedule.
 */
export async function isPagedForIncident(
  actor: Pick<AuthorizationActor, 'id' | 'teamIds'>,
  escalationPolicyId: string | null,
  now: Date = new Date()
): Promise<boolean> {
  if (!escalationPolicyId) return false;
  const rules = await prisma.escalationRule.findMany({
    where: { policyId: escalationPolicyId },
    select: { targetUserId: true, targetTeamId: true, targetScheduleId: true },
  });
  if (rules.some(rule => rule.targetUserId === actor.id)) return true;
  const teams = new Set(actor.teamIds);
  if (rules.some(rule => rule.targetTeamId && teams.has(rule.targetTeamId))) return true;
  const scheduleIds = [
    ...new Set(rules.map(rule => rule.targetScheduleId).filter((id): id is string => !!id)),
  ];
  if (scheduleIds.length === 0) return false;
  const shifts = await getActiveOnCallShifts(now, { where: { id: { in: scheduleIds } } });
  return shifts.some(shift => shift.userId === actor.id);
}

/**
 * Loads an incident with every relation the policy engine needs. The on-call lookup only runs
 * when cheaper relations (assignee, team) do not already grant operator access.
 */
export async function resolveIncidentResourceForActor(
  actor: AuthorizationActor,
  incidentId: string
): Promise<IncidentAccessResource | null> {
  const loaded = await loadIncidentAccessResource(incidentId);
  if (!loaded) return null;
  const { escalationPolicyId, ...resource } = loaded;
  if (incidentOperatorRelation(actor, resource)) return resource;
  // Organization-wide access needs no relationship; skip the on-call lookup.
  if (
    actorHasCapability(actor, CAPABILITIES.OPERATIONS_MANAGE) &&
    actorHasCapability(actor, CAPABILITIES.INCIDENT_READ_ALL)
  )
    return resource;
  if (await isPagedForIncident(actor, escalationPolicyId)) {
    return { ...resource, onCallUserIds: [actor.id] };
  }
  return resource;
}
