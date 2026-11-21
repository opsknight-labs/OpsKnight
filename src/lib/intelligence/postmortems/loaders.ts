import 'server-only';
import prisma from '@/lib/prisma';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import {
  incidentReadWhere,
  postmortemReadWhere,
  runbookReadWhere,
} from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { getResponseIntelligenceForActor } from '../response/view';
import { enabledOpsInsightAreas } from '../ops-insights/contract';
import { getIntelligenceSettings } from '../settings/service';
import { getSimilarIncidentsForActor } from '../similarity/view';
import { getIncidentTimeAxisForActor } from '../timeline/service';
import {
  suggestActionItems,
  type ActionItemSuggestion,
  type ExistingActionItem,
  type PostmortemEvidence,
} from './evidence-draft';
import {
  isOverdue,
  RECURRENCE_LIMITS,
  RECURRENCE_WINDOW_DAYS,
  type PostmortemRecurrence,
  type RecurrenceActionItem,
} from './recurrence';

/**
 * Reads behind postmortem intelligence. Everything here runs on a page read or a person's click, never in
 * event ingestion, and every query is bounded and index-backed. The `*ForActor` loaders answer null while
 * the postmortem switch is off or the viewer may not read the incident, and filter every related incident,
 * postmortem, action item and runbook through the viewer's own read rules.
 */

const DAY_MS = 86_400_000;
const MAX_RUNBOOK_RUNS = 20;
const MAX_OWN_ACTION_ITEMS = 50;
type Client = typeof prisma;
/** A read filter, or null when the actor has no read rule for that kind (then nothing of it is shown). */
const readWhere = <T>(build: () => T): T | null => {
  try {
    return build();
  } catch {
    return null;
  }
};

interface Options {
  client?: Client;
  now?: Date;
}

async function visibleIncident(incidentId: string, actor: AuthorizationActor, client: Client) {
  if (!hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_SUGGESTIONS_READ)) return null;
  // The postmortem area switch, under the operations-insights master switch.
  if (!enabledOpsInsightAreas(await getIntelligenceSettings(client)).includes('postmortems'))
    return null;
  const readable = readWhere(() => incidentReadWhere(actor));
  if (!readable) return null;
  const incident = await client.incident.findFirst({
    where: { AND: [{ id: incidentId }, readable] },
    select: {
      id: true,
      createdAt: true,
      resolvedAt: true,
      intelligenceFingerprint: { select: { serviceId: true, template: true } },
    },
  });
  return incident ? { incident, readable } : null;
}

type Visible = NonNullable<Awaited<ReturnType<typeof visibleIncident>>>;

async function recurrenceFor(
  { incident, readable }: Visible,
  actor: AuthorizationActor,
  client: Client,
  now: Date
): Promise<PostmortemRecurrence | null> {
  const fingerprint = incident.intelligenceFingerprint;
  if (!fingerprint?.template) return null;
  // Served by idx_incident_fingerprint_problem (serviceId, template, incidentCreatedAt).
  const earlier = await client.incidentFingerprint.findMany({
    where: {
      serviceId: fingerprint.serviceId,
      template: fingerprint.template,
      incidentCreatedAt: { gte: new Date(now.getTime() - RECURRENCE_WINDOW_DAYS * DAY_MS) },
      incidentId: { not: incident.id },
      incident: readable,
    },
    orderBy: { incidentCreatedAt: 'desc' },
    take: RECURRENCE_LIMITS.occurrences,
    select: { incidentId: true, incidentCreatedAt: true, incident: { select: { title: true } } },
  });
  if (earlier.length === 0) return null;

  const incidentIds = earlier.map(row => row.incidentId);
  const postmortems = readWhere(() => postmortemReadWhere(actor));
  const [lastPostmortem, items] = postmortems
    ? await Promise.all([
        client.postmortem.findFirst({
          where: { AND: [{ incidentId: { in: incidentIds } }, postmortems] },
          orderBy: { createdAt: 'desc' },
          select: { incidentId: true, title: true, status: true, createdAt: true },
        }),
        client.actionItem.findMany({
          where: {
            incidentId: { in: incidentIds },
            status: { not: 'COMPLETED' },
            postmortem: postmortems,
          },
          orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
          take: RECURRENCE_LIMITS.openItems,
          select: {
            id: true,
            title: true,
            status: true,
            priority: true,
            dueDate: true,
            incidentId: true,
          },
        }),
      ])
    : [null, []];
  const open: RecurrenceActionItem[] = items.map(item => ({
    ...item,
    overdue: isOverdue(item, now),
  }));
  return {
    template: fingerprint.template,
    windowDays: RECURRENCE_WINDOW_DAYS,
    occurrences: earlier.length + 1,
    capped: earlier.length === RECURRENCE_LIMITS.occurrences,
    previous: earlier.slice(0, RECURRENCE_LIMITS.incidents).map(row => ({
      incidentId: row.incidentId,
      title: row.incident.title,
      createdAt: row.incidentCreatedAt,
    })),
    lastPostmortem,
    openActionItems: open.slice(0, RECURRENCE_LIMITS.actionItems),
    openActionItemCount: open.length,
    overdueActionItemCount: open.filter(item => item.overdue).length,
  };
}

/**
 * "Seen N times in 90 days; last postmortem; action items still open" for one incident, or null when there
 * is nothing to say (first occurrence, switch off, not readable). For the postmortem editor and the
 * incident page.
 */
export async function getPostmortemRecurrenceForActor(
  incidentId: string,
  actor: AuthorizationActor,
  { client = prisma, now = new Date() }: Options = {}
): Promise<PostmortemRecurrence | null> {
  const visible = await visibleIncident(incidentId, actor, client);
  return visible ? recurrenceFor(visible, actor, client, now) : null;
}

export interface PostmortemAssist {
  /** Incident start and resolution, for the timeline-gap check. */
  window: { start: Date; end: Date | null };
  recurrence: PostmortemRecurrence | null;
  evidence: PostmortemEvidence;
  suggestions: ActionItemSuggestion[];
}

/**
 * Everything the postmortem editor shows beside the form and Auto-Draft writes into it: recurrence, the
 * evidence for the draft and action-item suggestions already checked against open action items (this
 * incident's and earlier occurrences'). Null while the switch is off or the incident is not readable.
 */
export async function getPostmortemAssistForActor(
  incidentId: string,
  actor: AuthorizationActor,
  { client = prisma, now = new Date() }: Options = {}
): Promise<PostmortemAssist | null> {
  const visible = await visibleIncident(incidentId, actor, client);
  if (!visible) return null;
  const runbooks = readWhere(() => runbookReadWhere(actor));
  const postmortems = readWhere(() => postmortemReadWhere(actor));
  const [recurrence, axis, response, similar, runs, own] = await Promise.all([
    recurrenceFor(visible, actor, client, now),
    getIncidentTimeAxisForActor(incidentId, actor, client),
    getResponseIntelligenceForActor(incidentId, actor, client),
    getSimilarIncidentsForActor(incidentId, actor, client),
    runbooks
      ? client.runbookExecution.findMany({
          where: { incidentId, runbook: runbooks },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: MAX_RUNBOOK_RUNS,
          select: {
            id: true,
            status: true,
            startedAt: true,
            completedAt: true,
            recoveryOutcome: true,
            runbook: { select: { name: true } },
          },
        })
      : [],
    postmortems
      ? client.actionItem.findMany({
          where: { incidentId, status: { not: 'COMPLETED' }, postmortem: postmortems },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: MAX_OWN_ACTION_ITEMS,
          select: { id: true, title: true },
        })
      : [],
  ]);

  // A cause is confirmed when any responder marked its suggestion helpful or correct.
  const causeFindingIds = [
    ...(response?.changes ?? []).map(change => change.findingId),
    ...(response?.upstreamIncidents ?? []).map(incident => incident.findingId),
  ];
  const accepted = new Set(
    causeFindingIds.length === 0
      ? []
      : (
          await client.intelligenceFeedback.findMany({
            where: {
              subjectType: 'FINDING',
              subjectId: { in: causeFindingIds },
              verdict: { in: ['HELPFUL', 'CORRECT'] },
            },
            distinct: ['subjectId'],
            select: { subjectId: true },
          })
        ).map(row => row.subjectId)
  );

  const evidence: PostmortemEvidence = {
    axis: (axis?.entries ?? []).map(entry => ({
      kind: entry.kind,
      at: entry.at,
      title: entry.title,
      detail: entry.detail,
      incidentId: entry.href?.startsWith('/incidents/')
        ? entry.href.slice('/incidents/'.length)
        : null,
    })),
    changes: (response?.changes ?? []).map(change => ({
      id: change.changeId,
      kind: change.kind,
      summary: change.summary,
      serviceName: change.serviceName,
      leadMinutes: change.leadMinutes,
      accepted: accepted.has(change.findingId),
    })),
    upstreamIncidents: (response?.upstreamIncidents ?? []).map(upstream => ({
      incidentId: upstream.incidentId,
      title: upstream.title,
      serviceName: upstream.serviceName,
      leadMinutes: upstream.leadMinutes,
      accepted: accepted.has(upstream.findingId),
    })),
    runbookRuns: runs.map(run => ({
      id: run.id,
      name: run.runbook.name,
      status: run.status,
      at: run.completedAt ?? run.startedAt,
      recoveryOutcome: run.recoveryOutcome,
    })),
    similarFixes: (similar ?? []).flatMap(item => {
      const fix = item.postmortem?.resolution ?? item.resolutionSummary;
      return fix ? [{ incidentId: item.incidentId, title: item.title, fix }] : [];
    }),
    recurrence,
  };
  const existing: ExistingActionItem[] = [
    ...own,
    ...(recurrence?.openActionItems ?? []).map(item => ({
      id: item.id,
      title: item.title,
      incidentId: item.incidentId,
    })),
  ];
  return {
    window: { start: visible.incident.createdAt, end: visible.incident.resolvedAt },
    recurrence,
    evidence,
    suggestions: suggestActionItems(evidence, existing),
  };
}

/**
 * Evidence for a draft that will be stored on `incidentId`'s postmortem: text from other incidents (titles,
 * fixes, their postmortem title) is kept only when that incident is PUBLIC and shares a team with this one,
 * so the saved postmortem does not show its readers incidents the drafter alone could see.
 */
export async function evidenceForStoredDraft(
  incidentId: string,
  evidence: PostmortemEvidence,
  client: Client = prisma
): Promise<PostmortemEvidence> {
  const cited = [
    ...evidence.axis.flatMap(entry => entry.incidentId ?? []),
    ...evidence.upstreamIncidents.map(incident => incident.incidentId),
    ...evidence.similarFixes.map(similar => similar.incidentId),
    ...(evidence.recurrence?.lastPostmortem ? [evidence.recurrence.lastPostmortem.incidentId] : []),
  ];
  const rows = await client.incident.findMany({
    where: { id: { in: [...new Set([incidentId, ...cited])] } },
    select: { id: true, visibility: true, teamId: true, service: { select: { teamId: true } } },
  });
  const teamsOf = (row: (typeof rows)[number]) =>
    [row.teamId, row.service.teamId].filter((team): team is string => team !== null);
  const target = rows.find(row => row.id === incidentId);
  const targetTeams = new Set(target ? teamsOf(target) : []);
  const shared = new Set(
    rows
      .filter(
        row =>
          row.id === incidentId ||
          (row.visibility === 'PUBLIC' && teamsOf(row).some(team => targetTeams.has(team)))
      )
      .map(row => row.id)
  );
  const recurrence = evidence.recurrence;
  return {
    ...evidence,
    axis: evidence.axis.filter(entry => !entry.incidentId || shared.has(entry.incidentId)),
    upstreamIncidents: evidence.upstreamIncidents.filter(item => shared.has(item.incidentId)),
    similarFixes: evidence.similarFixes.filter(item => shared.has(item.incidentId)),
    recurrence:
      recurrence?.lastPostmortem && !shared.has(recurrence.lastPostmortem.incidentId)
        ? { ...recurrence, lastPostmortem: { ...recurrence.lastPostmortem, title: '' } }
        : recurrence,
  };
}
