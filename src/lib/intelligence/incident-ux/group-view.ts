import 'server-only';
import type { IncidentStatus } from '@prisma/client';
import prisma from '@/lib/prisma';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { incidentReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { incidentRef } from './explain';

/**
 * The storm / correlation group an incident belongs to, for the incident page's group view.
 *
 * A group is anchored on a parent incident. Its members are child incidents linked to it by an accepted
 * PARENT_CHILD relationship and alerts the storm control grouped into it (applied GROUP_CHILD decisions).
 * When the viewed incident is a child, the group of its parent is shown with the viewed incident marked.
 *
 * Scoped: child incidents the viewer may not read are not listed (only counted); when the parent itself
 * is not readable, the view says so and shows nothing else. Bounded: at most MAX_MEMBERS of each kind.
 */

export const GROUP_VIEW_MAX_MEMBERS = 40;

export interface GroupIncidentRef {
  id: string;
  ref: string;
  title: string;
  status: IncidentStatus;
  createdAt: Date;
}

export type GroupMember =
  | {
      kind: 'INCIDENT';
      id: string;
      ref: string;
      title: string;
      status: IncidentStatus;
      at: Date;
      relationshipId: string;
      automatic: boolean;
      current: boolean;
    }
  | {
      kind: 'ALERT';
      decisionId: string;
      alertId: string | null;
      title: string;
      at: Date;
      /** True when this alert was kept from paging and has not been released yet. */
      ungroupable: boolean;
      reversed: boolean;
    };

export interface IncidentGroupView {
  /** PARENT: the viewed incident is the anchor. CHILD: it is grouped under `parent`. */
  role: 'PARENT' | 'CHILD';
  parent: GroupIncidentRef | null;
  /** CHILD only: the parent exists but the viewer may not read it. */
  parentHidden: boolean;
  members: GroupMember[];
  hiddenMembers: number;
  /** When the group's parent opened: the zero point of the mini timeline. */
  anchorOnset: Date;
  truncated: boolean;
  /** Release a grouped alert so it pages (noise-control reversal): INTELLIGENCE_MANAGE. */
  canUngroupAlerts: boolean;
  /** Remove a child from the group (relationship decision): INTELLIGENCE_FEEDBACK. */
  canUngroupIncidents: boolean;
}

export async function getIncidentGroupForActor(
  incidentId: string,
  actor: AuthorizationActor,
  client: typeof prisma = prisma
): Promise<IncidentGroupView | null> {
  if (!hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_SUGGESTIONS_READ)) return null;
  let readable: ReturnType<typeof incidentReadWhere>;
  try {
    readable = incidentReadWhere(actor);
  } catch {
    return null;
  }
  const incident = await client.incident.findFirst({
    where: { AND: [{ id: incidentId }, readable] },
    select: { id: true, createdAt: true },
  });
  if (!incident) return null;

  const parentLink = await client.incidentRelationship.findFirst({
    where: { sourceIncidentId: incidentId, type: 'PARENT_CHILD', decision: 'ACCEPTED' },
    orderBy: { updatedAt: 'desc' },
    select: { targetIncidentId: true },
  });
  const anchorId = parentLink?.targetIncidentId ?? incidentId;
  const role: IncidentGroupView['role'] = parentLink ? 'CHILD' : 'PARENT';
  const canUngroupAlerts =
    actor.status === 'ACTIVE' && hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_MANAGE);
  const canUngroupIncidents =
    actor.status === 'ACTIVE' && hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_FEEDBACK);

  const parent =
    role === 'CHILD'
      ? await client.incident.findFirst({
          where: { AND: [{ id: anchorId }, readable] },
          select: { id: true, title: true, status: true, createdAt: true },
        })
      : null;
  if (role === 'CHILD' && !parent) {
    return {
      role,
      parent: null,
      parentHidden: true,
      members: [],
      hiddenMembers: 0,
      anchorOnset: incident.createdAt,
      truncated: false,
      canUngroupAlerts: false,
      canUngroupIncidents: false,
    };
  }

  const [children, totalChildren, decisions] = await Promise.all([
    client.incidentRelationship.findMany({
      where: {
        targetIncidentId: anchorId,
        type: 'PARENT_CHILD',
        decision: 'ACCEPTED',
        source: { is: readable },
      },
      orderBy: { createdAt: 'asc' },
      take: GROUP_VIEW_MAX_MEMBERS + 1,
      select: {
        id: true,
        evidence: true,
        source: { select: { id: true, title: true, status: true, createdAt: true } },
      },
    }),
    client.incidentRelationship.count({
      where: { targetIncidentId: anchorId, type: 'PARENT_CHILD', decision: 'ACCEPTED' },
    }),
    client.prePagingDecision.findMany({
      where: { incidentId: anchorId, action: 'GROUP_CHILD' },
      orderBy: { createdAt: 'asc' },
      take: GROUP_VIEW_MAX_MEMBERS + 1,
      select: {
        id: true,
        alertId: true,
        applied: true,
        mode: true,
        reversedAt: true,
        createdAt: true,
      },
    }),
  ]);
  const alertIds = decisions.flatMap(d => (d.alertId ? [d.alertId] : []));
  const alerts = alertIds.length
    ? await client.alert.findMany({
        where: { id: { in: alertIds }, incidentId: anchorId },
        select: { id: true, payload: true },
      })
    : [];
  const alertSummary = new Map(
    alerts.map(alert => {
      const payload = alert.payload as { summary?: unknown } | null;
      return [
        alert.id,
        typeof payload?.summary === 'string' ? payload.summary.slice(0, 160) : 'Alert',
      ];
    })
  );

  const members: GroupMember[] = [];
  for (const child of children.slice(0, GROUP_VIEW_MAX_MEMBERS)) {
    const evidence = child.evidence as { automatic?: unknown } | null;
    members.push({
      kind: 'INCIDENT',
      id: child.source.id,
      ref: incidentRef(child.source.id),
      title: child.source.title,
      status: child.source.status,
      at: child.source.createdAt,
      relationshipId: child.id,
      automatic: evidence?.automatic === true,
      current: child.source.id === incidentId,
    });
  }
  for (const decision of decisions.slice(0, GROUP_VIEW_MAX_MEMBERS)) {
    // Shadow decisions never grouped anything: they belong in the timeline, not in the group.
    if (!decision.applied || decision.mode !== 'ON') continue;
    members.push({
      kind: 'ALERT',
      decisionId: decision.id,
      alertId: decision.alertId,
      title: (decision.alertId && alertSummary.get(decision.alertId)) || 'Grouped alert',
      at: decision.createdAt,
      ungroupable: decision.reversedAt === null && decision.alertId !== null,
      reversed: decision.reversedAt !== null,
    });
  }
  if (!members.length && role === 'PARENT') return null;
  members.sort((a, b) => a.at.getTime() - b.at.getTime());

  return {
    role,
    parent: parent ? { ...parent, ref: incidentRef(parent.id) } : null,
    parentHidden: false,
    members,
    hiddenMembers:
      children.length > GROUP_VIEW_MAX_MEMBERS ? 0 : Math.max(0, totalChildren - children.length),
    anchorOnset: parent?.createdAt ?? incident.createdAt,
    truncated:
      children.length > GROUP_VIEW_MAX_MEMBERS || decisions.length > GROUP_VIEW_MAX_MEMBERS,
    canUngroupAlerts,
    canUngroupIncidents,
  };
}
