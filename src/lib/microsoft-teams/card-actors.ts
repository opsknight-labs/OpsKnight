import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { INCIDENT_ROLE_SUMMARY_SELECT, summarizeIncidentRoles } from '@/lib/incidents/roles';

/**
 * Read-only card adornments that are not columns on Incident: who acknowledged / resolved, the
 * role holders, and the current escalation level + target. Every lookup is best-effort: a card is
 * never blocked because one of these reads failed.
 */
export type TeamsCardPeople = {
  acknowledgedBy: string | null;
  resolvedBy: string | null;
  roles: Array<{ shortLabel: string; name: string }>;
  escalation: { level: number; target: string | null } | null;
};

/** "Incident resolved by Alice" / "Resolution note added by Alice" → "Alice". */
export function actorFromLifecycleMessage(message: string | null | undefined): string | null {
  const match = /(?:resolved|acknowledged|resolution note added) by (.+?)\s*$/i.exec(message ?? '');
  const name = match?.[1]?.replace(/\s+via\s+.+$/i, '').trim();
  return name ? name.slice(0, 120) : null;
}

/** "Escalated to Bob (Level 2, after 5 minute delay)" → { level: 2, target: "Bob" }. */
export function escalationFromEventMessage(
  message: string | null | undefined
): { level: number; target: string | null } | null {
  const match = /escalated to (.+?)\s*\(level (\d+)/i.exec(message ?? '');
  if (!match) return null;
  const level = Number.parseInt(match[2], 10);
  if (!Number.isFinite(level) || level < 1) return null;
  return { level, target: match[1].trim().slice(0, 120) || null };
}

export async function loadTeamsCardPeople(incident: {
  id: string;
  status: string;
  acknowledgedById?: string | null;
  acknowledgedAt?: Date | null;
  resolvedAt?: Date | null;
  currentEscalationStep?: number | null;
}): Promise<TeamsCardPeople> {
  const people: TeamsCardPeople = {
    acknowledgedBy: null,
    resolvedBy: null,
    roles: [],
    escalation: null,
  };
  const tasks: Array<Promise<unknown>> = [];
  // Deferred so a synchronous throw (e.g. a missing delegate) is also caught by allSettled.
  const run = (fn: () => Promise<unknown>) => tasks.push(Promise.resolve().then(fn));
  const acknowledgedById = incident.acknowledgedById;
  if (acknowledgedById)
    run(() =>
      prisma.user
        .findUnique({ where: { id: acknowledgedById }, select: { name: true } })
        .then(user => {
          people.acknowledgedBy = user?.name?.trim() || null;
        })
    );
  const resolvedAt = incident.resolvedAt;
  if (incident.status === 'RESOLVED' && resolvedAt)
    run(() =>
      prisma.incidentEvent
        .findMany({
          where: {
            incidentId: incident.id,
            createdAt: { gte: new Date(resolvedAt.getTime() - 5_000) },
            type: { in: ['MANUAL_RESOLVED', 'AUTO_RESOLVED', 'COMMENT'] },
          },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { type: true, message: true },
        })
        .then(events => {
          for (const event of events) {
            const name = actorFromLifecycleMessage(event.message);
            if (name) {
              people.resolvedBy = name;
              return;
            }
          }
          if (events.some(event => event.type === 'AUTO_RESOLVED'))
            people.resolvedBy = 'automation';
        })
    );
  run(() =>
    prisma.incident
      .findUnique({
        where: { id: incident.id },
        select: { roleAssignments: INCIDENT_ROLE_SUMMARY_SELECT },
      })
      .then(row => {
        people.roles = summarizeIncidentRoles(row?.roleAssignments).map(role => ({
          shortLabel: role.shortLabel,
          name: role.name,
        }));
      })
  );
  if (incident.status === 'OPEN' && !incident.acknowledgedAt)
    run(() =>
      prisma.incidentEvent
        .findFirst({
          where: { incidentId: incident.id, type: 'ESCALATED' },
          orderBy: { createdAt: 'desc' },
          select: { message: true },
        })
        .then(event => {
          const parsed = escalationFromEventMessage(event?.message);
          const level =
            parsed?.level ??
            // currentEscalationStep is the step that runs next, which equals the levels already paged.
            (typeof incident.currentEscalationStep === 'number'
              ? incident.currentEscalationStep
              : null);
          if (level && level > 1) people.escalation = { level, target: parsed?.target ?? null };
        })
    );
  const settled = await Promise.allSettled(tasks);
  const failed = settled.filter(result => result.status === 'rejected').length;
  if (failed)
    logger.warn('[MicrosoftTeams] Card people lookup partially failed', {
      incidentId: incident.id,
      failed,
    });
  return people;
}
