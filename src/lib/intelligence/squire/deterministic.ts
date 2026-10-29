import 'server-only';
import prisma from '@/lib/prisma';
import { incidentReadWhere, scheduleReadWhere } from '@/lib/authorization-filters';
import { getActiveOnCallShifts } from '@/lib/oncall-shifts';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { getRelatedIncidentsForActor } from '../correlation/view';
import { getResponseIntelligenceForActor } from '../response/view';
import { getSimilarIncidentsForActor } from '../similarity/view';
import { routeIntent, type SquireIntent } from './intents';

const MAX_LIST = 5;

export interface ReadableIncident {
  id: string;
  title: string;
  status: string;
  urgency: string;
  serviceName: string;
  createdAt: Date;
}

/** The incident, only if the actor may read it. */
export async function readIncidentForActor(
  actor: AuthorizationActor,
  incidentId: string,
  client: typeof prisma = prisma
): Promise<ReadableIncident | null> {
  let readable;
  try {
    readable = incidentReadWhere(actor);
  } catch {
    return null;
  }
  const row = await client.incident.findFirst({
    where: { AND: [{ id: incidentId }, readable] },
    select: {
      id: true,
      title: true,
      status: true,
      urgency: true,
      createdAt: true,
      service: { select: { name: true } },
    },
  });
  return row
    ? {
        id: row.id,
        title: row.title,
        status: row.status,
        urgency: row.urgency,
        serviceName: row.service.name,
        createdAt: row.createdAt,
      }
    : null;
}

const minutes = (value: number) =>
  value < 1
    ? 'moments before'
    : value < 90
      ? `${value} min before`
      : `${Math.round(value / 60)} h before`;

async function activeIncidents(actor: AuthorizationActor): Promise<string> {
  let readable;
  try {
    readable = incidentReadWhere(actor);
  } catch {
    return 'You do not have access to incidents.';
  }
  const where = { AND: [{ status: { in: ['OPEN' as const, 'ACKNOWLEDGED' as const] } }, readable] };
  const [open, acknowledged, top] = await Promise.all([
    prisma.incident.count({ where: { AND: [{ status: 'OPEN' as const }, readable] } }),
    prisma.incident.count({ where: { AND: [{ status: 'ACKNOWLEDGED' as const }, readable] } }),
    prisma.incident.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: MAX_LIST,
      select: { id: true, title: true, status: true, service: { select: { name: true } } },
    }),
  ]);
  if (open + acknowledged === 0)
    return 'Nothing is on fire right now: no open or acknowledged incidents that you can see.';
  const lines = top.map(
    incident =>
      `• ${incident.title} (${incident.service.name}, ${incident.status.toLowerCase()})\n  /incidents/${incident.id}`
  );
  return [`${open} open and ${acknowledged} acknowledged incidents. Most recent:`, ...lines].join(
    '\n'
  );
}

async function describeIncident(
  actor: AuthorizationActor,
  incident: ReadableIncident,
  intent: SquireIntent
): Promise<string> {
  const head = `${incident.title}\n${incident.serviceName} · ${incident.status.toLowerCase()} · ${incident.urgency.toLowerCase()} urgency`;
  if (intent === 'SIMILAR') {
    const [similar, related] = await Promise.all([
      getSimilarIncidentsForActor(incident.id, actor),
      getRelatedIncidentsForActor(incident.id, actor),
    ]);
    const lines = [
      ...(similar ?? []).map(
        item =>
          `• ${item.title} (${item.matchPercent}% match, ${item.status.toLowerCase()})\n  /incidents/${item.incidentId}`
      ),
      ...(related ?? []).map(item => `• Related: ${item.title}\n  /incidents/${item.incidentId}`),
    ];
    return lines.length > 0
      ? ['Similar and related incidents:', ...lines].join('\n')
      : 'I have no similar or related incidents for this one yet.';
  }
  const response = await getResponseIntelligenceForActor(incident.id, actor);
  if (intent === 'CAUSES') {
    if (!response || (response.changes.length === 0 && response.upstreamIncidents.length === 0)) {
      return 'I have no likely causes for this incident. Recording deploys and declaring service dependencies improves this.';
    }
    const lines = [
      ...response.changes.map(
        c =>
          `• ${c.summary} (${c.kind.replace('_', ' ').toLowerCase()}, ${minutes(c.leadMinutes)} onset)`
      ),
      ...response.upstreamIncidents.map(
        u =>
          `• Upstream incident: ${u.title} (${u.serviceName}, ${minutes(u.leadMinutes)} this one)\n  /incidents/${u.incidentId}`
      ),
    ];
    return [
      'Possible causes, based on timing and dependencies. These are leads to verify, not confirmed causes:',
      ...lines,
    ].join('\n');
  }
  if (intent === 'RUNBOOKS') {
    if (!response || response.runbooks.length === 0)
      return 'I have no runbook recommendations for this incident.';
    const lines = response.runbooks.map(
      r =>
        `• ${r.name} — ${r.eligible > 0 ? `succeeded ${r.succeeded} of ${r.eligible} runs here` : 'attached, not run yet'}\n  /runbooks/${r.runbookId}`
    );
    return [
      'Runbooks that fit this service (I can only suggest them; nothing is run for you):',
      ...lines,
    ].join('\n');
  }
  const extras = response
    ? [
        response.changes[0] ? `Most likely lead: ${response.changes[0].summary}.` : null,
        response.runbooks[0] ? `Suggested runbook: ${response.runbooks[0].name}.` : null,
      ].filter((line): line is string => line !== null)
    : [];
  return [head, ...extras, 'Ask me about similar incidents, likely causes, or runbooks.'].join(
    '\n'
  );
}

/** Who is on call now: the schedules the incident's service escalates to, or every schedule the person can see. */
async function onCall(
  actor: AuthorizationActor,
  incident: ReadableIncident | null
): Promise<string> {
  let readable;
  try {
    readable = scheduleReadWhere(actor);
  } catch {
    return 'You do not have access to on-call schedules.';
  }
  let scheduleIds: string[] | null = null;
  if (incident) {
    const row = await prisma.incident.findUnique({
      where: { id: incident.id },
      select: {
        service: {
          select: { policy: { select: { steps: { select: { targetScheduleId: true } } } } },
        },
      },
    });
    scheduleIds = (row?.service.policy?.steps ?? [])
      .map(step => step.targetScheduleId)
      .filter((id): id is string => Boolean(id));
  }
  const shifts = await getActiveOnCallShifts(new Date(), {
    where:
      scheduleIds && scheduleIds.length > 0
        ? { AND: [{ id: { in: scheduleIds } }, readable] }
        : readable,
  });
  if (shifts.length === 0) return 'Nobody is on call in the schedules you can see right now.';
  const lines = shifts
    .slice(0, MAX_LIST * 2)
    .map(
      shift =>
        `• ${shift.user.name ?? shift.user.email ?? 'Unknown'} (${shift.schedule.name}) until ${shift.end.toISOString().slice(11, 16)} UTC`
    );
  return [
    scheduleIds && scheduleIds.length > 0 ? 'On call for this service now:' : 'On call now:',
    ...lines,
  ].join('\n');
}

const HELP = [
  'I can help with incidents you are allowed to see:',
  '• "What is on fire?" for current open incidents',
  '• "Who is on call?"',
  '• On an incident page: "similar incidents", "what caused this?", "which runbook?"',
  'With AI enabled by an administrator I can also answer free-form questions about your incidents.',
  'I never change anything on my own: with AI on I can suggest actions, and they happen only when you confirm them.',
].join('\n');

/**
 * Answers with no language model. It reads only through the actor-scoped intelligence views and
 * incident visibility rules, so it can never show more than the person could open themselves.
 */
export async function answerDeterministically(
  actor: AuthorizationActor,
  message: string,
  incident: ReadableIncident | null
): Promise<string> {
  const intent = routeIntent(message, incident !== null);
  switch (intent) {
    case 'HELP':
      return HELP;
    case 'ACTIVE_INCIDENTS':
      return activeIncidents(actor);
    case 'ON_CALL':
      return onCall(actor, incident);
    case 'SIMILAR':
    case 'CAUSES':
    case 'RUNBOOKS':
    case 'INCIDENT_SUMMARY':
      return incident ? describeIncident(actor, incident, intent) : HELP;
    default:
      return `I did not catch that. ${HELP}`;
  }
}
