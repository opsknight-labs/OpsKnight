import 'server-only';
import type { EvidenceSnapshot } from './evidence';
type Collect = (source: EvidenceSnapshot) => void;
import prisma from '@/lib/prisma';
import { readIncidentAnalysisState } from '../analysis/view';
import { redactSecrets } from '../ai/redact';
import {
  incidentReadWhere,
  scheduleReadWhere,
  serviceReadWhere,
  teamReadWhere,
} from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { getRelatedIncidentsForActor } from '../correlation/view';
import { getResponseIntelligenceForActor } from '../response/view';
import { getSimilarIncidentsForActor } from '../similarity/view';
import { routeIntent, incidentIntents, type SquireIntent } from './intents';
import { answerBasicReadDetailed, BASIC_PAGE_SIZE, type BasicReadOptions } from './basic/reads';
import { productGuidance } from './basic/guidance';
import { keywords, mergeBasicQuestion } from './basic/query';
import {
  classifyIntent,
  correctSpelling,
  extractSlots,
  normalizeMessage,
  parseSlashCommand,
  type Slots,
  type SpellingCorrection,
} from './basic/nlu';
import { confidentMatch, resolveEntities, type EntityMatch } from './basic/entities';
import { checksFor, BUILT_IN_CHECKS, safePattern } from './basic/checks';
import { pageState, pendingState, type DialogueState } from './basic/state';
import { suggestFollowUps } from './basic/suggestions';
import { BASIC_ANSWER_TTL_MS, TtlCache } from './basic/cache';
import type { SquireActionName } from './actions/catalog';
import type { SquireRequest } from './contract';

export interface ReadableIncident {
  id: string;
  title: string;
  status: string;
  urgency: string;
  serviceName: string;
  createdAt: Date;
  updatedAt?: Date;
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
      updatedAt: true,
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
        updatedAt: row.updatedAt,
      }
    : null;
}

const minutes = (value: number) =>
  value < 1
    ? 'moments before'
    : value < 90
      ? `${value} min before`
      : `${Math.round(value / 60)} h before`;

async function describeIncident(
  actor: AuthorizationActor,
  incident: ReadableIncident,
  intent: SquireIntent,
  collect?: Collect
): Promise<string> {
  collect?.({ kind: 'incident', id: incident.id, label: incident.title, data: incident });
  const head = `${incident.title}\n${incident.serviceName} · ${incident.status.toLowerCase()} · ${incident.urgency.toLowerCase()} urgency`;
  if (intent === 'SIMILAR') {
    const [similar, related] = await Promise.all([
      getSimilarIncidentsForActor(incident.id, actor),
      getRelatedIncidentsForActor(incident.id, actor),
    ]);
    [...(similar ?? []), ...(related ?? [])].forEach(data =>
      collect?.({ kind: 'incident', id: data.incidentId, label: data.title, data })
    );
    const lines = [
      ...(similar ?? []).map(
        item =>
          `• ${item.title} (${item.matchPercent}% match, ${item.status.toLowerCase()}; ${item.serviceName})${item.resolutionSummary ? `\n  Recorded resolution: ${short(item.resolutionSummary)}` : ''}\n  /incidents/${item.incidentId}`
      ),
      ...(related ?? []).map(item => `• Related: ${item.title}\n  /incidents/${item.incidentId}`),
    ];
    return lines.length > 0
      ? [
          'Similar and related incidents (match scores measure similarity, not certainty):',
          ...lines,
        ].join('\n')
      : 'I have no similar or related incidents for this one yet. That does not mean it has never happened: indexing or recommendation analysis may still be catching up.';
  }
  const response = await getResponseIntelligenceForActor(incident.id, actor);
  if (intent === 'CAUSES') {
    response?.changes.forEach(data =>
      collect?.({ kind: 'change', id: data.changeId, label: data.summary, data })
    );
    response?.upstreamIncidents.forEach(data =>
      collect?.({ kind: 'incident', id: data.incidentId, label: data.title, data })
    );
    if (!response || (response.changes.length === 0 && response.upstreamIncidents.length === 0)) {
      return `I have no likely causes recorded for this incident yet.\n\n${await suggestedChecksFor(incident)}\n\nCheck recent deployments and upstream service health; timing alone cannot establish a cause.`;
    }
    const lines = [
      ...response.changes.map(
        c =>
          `• ${c.summary} (${c.kind.replace('_', ' ').toLowerCase()}, ${minutes(c.leadMinutes)} onset)\n  /changes/${c.changeId}`
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
    response?.runbooks.forEach(data =>
      collect?.({ kind: 'runbook', id: data.runbookId, label: data.name, data })
    );
    if (!response || response.runbooks.length === 0)
      return `I have no runbook recommendations for this incident.\n\n${await suggestedChecksFor(incident)}\n\nCheck similar resolved incidents for a previously recorded fix, or attach a reviewed runbook to this service.`;
    const lines = response.runbooks.map(
      r =>
        `• ${r.name} — ${r.eligible > 0 ? `succeeded ${r.succeeded} of ${r.eligible} runs here` : 'attached, not run yet'}\n  /runbooks/${r.runbookId}`
    );
    return [
      'Runbooks that fit this service (I can only suggest them; nothing is run for you):',
      ...lines,
      '',
      await suggestedChecksFor(incident),
    ].join('\n');
  }
  if (response?.changes[0]) {
    const data = response.changes[0];
    collect?.({ kind: 'change', id: data.changeId, label: data.summary, data });
  }
  if (response?.runbooks[0]) {
    const data = response.runbooks[0];
    collect?.({ kind: 'runbook', id: data.runbookId, label: data.name, data });
  }
  const [similar, events] = await Promise.all([
    getSimilarIncidentsForActor(incident.id, actor),
    prisma.incidentEvent
      .findMany({
        where: { incidentId: incident.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 3,
        select: { type: true, createdAt: true },
      })
      .catch(() => []),
  ]);
  const precedent = similar?.find(row => row.status === 'RESOLVED') ?? similar?.[0];
  if (precedent)
    collect?.({
      kind: 'incident',
      id: precedent.incidentId,
      label: precedent.title,
      data: precedent,
    });
  return [
    head,
    `Opened ${incident.createdAt.toISOString().replace('T', ' ').slice(0, 16)} UTC.`,
    `/incidents/${incident.id}`,
    '',
    events.length
      ? `Latest recorded events: ${events
          .map(
            event =>
              `${(event.type ?? 'EVENT').replace(/_/g, ' ').toLowerCase()} at ${event.createdAt.toISOString().slice(11, 16)} UTC`
          )
          .join('; ')}.`
      : 'No events are recorded after the incident opened.',
    response?.changes[0]
      ? `Change to investigate: ${response.changes[0].summary} (a lead to verify).\n/changes/${response.changes[0].changeId}`
      : 'No deployment or change lead is recorded yet.',
    precedent
      ? `Past context: ${precedent.title} (${precedent.matchPercent}% similar).${precedent.resolutionSummary ? ` Recorded resolution: ${short(precedent.resolutionSummary)}` : ''}\n/incidents/${precedent.incidentId}`
      : 'No matching past incident is recorded yet.',
    response?.runbooks[0]
      ? `Suggested runbook: ${response.runbooks[0].name}.\n/runbooks/${response.runbooks[0].runbookId}`
      : 'No reviewed runbook recommendation is recorded yet.',
    '',
    await suggestedChecksFor(incident),
  ].join('\n');
}

const short = (text: string) => redactSecrets(text).replace(/\s+/g, ' ').trim().slice(0, 280);

const renderChecks = (checks: string[]) =>
  [
    'Suggested checks (not a confirmed diagnosis):',
    ...checks.map((check, i) => `${i + 1}. ${check}`),
    'No action has been executed.',
  ].join('\n');

/** Pattern-based investigation prompts from the built-in library only; synchronous, for templates and tests. */
export function suggestedChecks(incident: Pick<ReadableIncident, 'title'>): string {
  const title = incident.title.toLowerCase();
  const template = BUILT_IN_CHECKS.find(entry => safePattern(entry.pattern)?.test(title));
  return renderChecks(
    template?.checks ?? [
      'Confirm the affected service, customer impact and whether the alert is still firing.',
      'Compare recent deployments, dependency health and similar resolved incidents.',
    ]
  );
}

/** The same prompts from the live library, which administrators can extend; never executed. */
export async function suggestedChecksFor(
  incident: Pick<ReadableIncident, 'title'>
): Promise<string> {
  try {
    return renderChecks((await checksFor(incident.title)).checks);
  } catch {
    return suggestedChecks(incident);
  }
}

const HELP = [
  'I can help with live OpsKnight data, even with AI turned off:',
  '• Your work queue, unassigned incidents, filtered incident search and counts, with paging ("show more").',
  '• Reports: incident volume by service, team, urgency, day or hour; period comparisons; bounded MTTA and MTTR.',
  '• Service health records, ownership, escalation policies and visible dependencies. Typos in names are matched to the closest service you can see.',
  '• On-call coverage for a named service or team, now, tomorrow or at a point in time.',
  '• Runbook catalog, recent changes, postmortems and overdue follow-up tasks.',
  '• Dates: "since 2026-11-01", "between Monday and Wednesday", "last Friday", "past 24 hours".',
  '• Product guidance: schedules, overrides, urgency, integrations, notifications, privacy and permissions.',
  '• On an incident: a briefing, similar incidents and recorded fixes, change leads, runbooks, a factual timeline, and proposals you confirm: "acknowledge this", "resolve this: rolled back v42", "add a note: …", "assign to Alice".',
  '• Shortcuts: /ack, /resolve <what fixed it>, /note <text>, /assign <name>, /oncall <service or team>, /incidents <filters>, /help.',
  'I never change anything on my own. A proposal happens only when you confirm its card. AI adds free-form reasoning on top of the same data.',
].join('\n');

async function timeline(incident: ReadableIncident, collect?: Collect): Promise<string> {
  const events = await prisma.incidentEvent.findMany({
    where: { incidentId: incident.id },
    take: 8,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { type: true, createdAt: true },
  });
  collect?.({ kind: 'incident', id: incident.id, label: incident.title, data: incident });
  return [
    `Recorded timeline for ${short(incident.title)}:`,
    `• ${incident.createdAt.toISOString()} — Incident opened.`,
    ...events
      .reverse()
      .map(
        event =>
          `• ${event.createdAt.toISOString()} — ${(event.type ?? 'EVENT').replace(/_/g, ' ').toLowerCase()}.`
      ),
    `/incidents/${incident.id}`,
    'This is the recorded event sequence, not an explanation of causality.',
  ].join('\n');
}

export type PageContext = NonNullable<SquireRequest['pageContext']>;

export interface ResolvedPageContext {
  kind: PageContext['kind'];
  id: string;
  name: string;
  /** For an alert page: the incident it belongs to, when readable, so the alert's incident is the context. */
  incidentId?: string;
  teamIds?: string[];
}

/** The page's entity, read under the person's own visibility; an unreadable or unknown id is ignored. */
export async function resolvePageContext(
  actor: AuthorizationActor,
  context: PageContext | undefined | null
): Promise<ResolvedPageContext | null> {
  if (!context) return null;
  try {
    switch (context.kind) {
      case 'service': {
        const row = await prisma.service.findFirst({
          where: { AND: [{ id: context.id }, serviceReadWhere(actor)] },
          select: { id: true, name: true, teamId: true },
        });
        return row
          ? { kind: 'service', id: row.id, name: row.name, teamIds: row.teamId ? [row.teamId] : [] }
          : null;
      }
      case 'team': {
        const row = await prisma.team.findFirst({
          where: { AND: [{ id: context.id }, teamReadWhere(actor)] },
          select: { id: true, name: true },
        });
        return row ? { kind: 'team', id: row.id, name: row.name, teamIds: [row.id] } : null;
      }
      case 'schedule': {
        const row = await prisma.onCallSchedule.findFirst({
          where: { AND: [{ id: context.id }, scheduleReadWhere(actor)] },
          select: { id: true, name: true },
        });
        return row ? { kind: 'schedule', id: row.id, name: row.name } : null;
      }
      case 'runbook': {
        const row = await prisma.runbook.findFirst({
          where: { id: context.id, archivedAt: null },
          select: { id: true, name: true },
        });
        return row ? { kind: 'runbook', id: row.id, name: row.name } : null;
      }
      case 'alert': {
        const row = await prisma.alert.findFirst({
          where: { id: context.id, incident: incidentReadWhere(actor) },
          select: { id: true, incidentId: true, service: { select: { name: true } } },
        });
        return row
          ? {
              kind: 'alert',
              id: row.id,
              name: row.service.name,
              ...(row.incidentId ? { incidentId: row.incidentId } : {}),
            }
          : null;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export interface BasicTurnInput {
  actor: AuthorizationActor;
  message: string;
  incident: ReadableIncident | null;
  page?: ResolvedPageContext | null;
  /** Earlier user questions, oldest first; used for intent and filters only. */
  previousQuestions?: readonly string[];
  state?: DialogueState | null;
  name?: string;
  now?: Date;
}

export interface BasicProposalRequest {
  action: SquireActionName;
  input: Record<string, unknown>;
}

export interface BasicTurnResult {
  text: string;
  intent: SquireIntent;
  /** Actions to build as proposal cards; basic mode never executes anything itself. */
  proposals: BasicProposalRequest[];
  suggestions: string[];
  nextState: DialogueState | null;
  corrections: SpellingCorrection[];
  /** True when the answer came from the short per-person cache. */
  cached: boolean;
}

const INTENT_LABEL: Partial<Record<SquireIntent, string>> = {
  WORK_QUEUE: 'My open incidents',
  ACTIVE_INCIDENTS: 'What is on fire right now?',
  INCIDENT_STATS: 'How many incidents this week?',
  ALERT_STATS: 'How many alerts today?',
  SERVICE_HEALTH: 'Service health and ownership',
  RUNBOOK_SEARCH: 'Search runbooks',
  RECENT_CHANGES: 'Recent changes',
  FOLLOWUPS: 'Follow-up items',
  POSTMORTEMS: 'Recent postmortems',
  ON_CALL: 'Who is on call?',
  SEARCH_INCIDENTS: 'Search incidents',
  SIMILAR: 'Have we seen this before?',
  CAUSES: 'What changed before this started?',
  RUNBOOKS: 'Which runbook fits?',
  TIMELINE: 'Show the timeline',
  RESPONDERS: 'Who is assigned to this incident?',
  INCIDENT_SUMMARY: 'Give me a briefing',
};

const READ_INTENTS: ReadonlySet<SquireIntent> = new Set([
  'ALERT_STATS',
  'ACTIVE_INCIDENTS',
  'WORK_QUEUE',
  'INCIDENT_STATS',
  'SERVICE_HEALTH',
  'RUNBOOK_SEARCH',
  'RECENT_CHANGES',
  'FOLLOWUPS',
  'POSTMORTEMS',
  'RESPONDERS',
  'ON_CALL',
  'SEARCH_INCIDENTS',
]);
const SERVICE_INTENTS: ReadonlySet<SquireIntent> = new Set([
  'SERVICE_HEALTH',
  'ON_CALL',
  'RECENT_CHANGES',
  'SEARCH_INCIDENTS',
  'ALERT_STATS',
  'INCIDENT_STATS',
  'WORK_QUEUE',
]);

const answerCache = new TtlCache<{
  text: string;
  snapshots: EvidenceSnapshot[];
  total?: number;
  hasMore?: boolean;
}>(BASIC_ANSWER_TTL_MS, 500);

const scopeKey = (actor: AuthorizationActor) =>
  `${actor.id}:${actor.role}:${[...actor.teamIds].sort().join(',')}`;

/** Turns a slash command into the plain question it stands for, or an action request. */
function expandSlash(message: string): { message: string; help?: boolean } {
  const slash = parseSlashCommand(message);
  if (!slash) return { message };
  switch (slash.command) {
    case 'help':
      return { message: 'help', help: true };
    case 'oncall':
      return { message: slash.args ? `who is on call for "${slash.args}"` : 'who is on call' };
    case 'incidents':
      return { message: slash.args ? `find incidents ${slash.args}` : 'show open incidents' };
    case 'ack':
      return { message: 'acknowledge this incident' };
    case 'resolve':
      return { message: `resolve this incident: ${slash.args}` };
    case 'note':
      return { message: `add a note: ${slash.args}` };
    case 'assign':
      return { message: `assign this to ${slash.args}` };
    case 'snooze':
      return { message: `snooze this incident ${slash.args}` };
  }
  return { message };
}

/**
 * One basic-mode turn: understand, resolve names, read, propose, and decide the next chips and dialogue
 * state. Everything is deterministic and permission-scoped; nothing here writes to incidents.
 */
export async function planBasicTurn(
  input: BasicTurnInput,
  collect?: Collect
): Promise<BasicTurnResult> {
  const { actor, name = 'Squire' } = input;
  const now = input.now ?? new Date();
  const incident = input.incident;
  const corrections: SpellingCorrection[] = [];
  const result = (
    text: string,
    intent: SquireIntent,
    extra: Partial<Omit<BasicTurnResult, 'text' | 'intent'>> = {}
  ): BasicTurnResult => ({
    text,
    intent,
    proposals: extra.proposals ?? [],
    suggestions:
      extra.suggestions ??
      suggestFollowUps({
        intent,
        incident,
        mode: 'basic',
        hasMore: extra.nextState?.page !== undefined,
      }),
    nextState: extra.nextState ?? null,
    corrections: extra.corrections ?? corrections,
    cached: extra.cached ?? false,
  });

  const expanded = expandSlash(input.message);
  if (expanded.help) return result(HELP, 'HELP');
  const normalized = normalizeMessage(expanded.message);
  const known = [incident?.serviceName ?? '', input.page?.name ?? ''].filter(Boolean);
  const corrected = correctSpelling(normalized, known);
  corrections.push(...corrected.corrections);
  let text = corrected.text;
  let slots = extractSlots(text, expanded.message);
  const state = input.state ?? null;
  const onIncident = incident !== null;

  // "Show more": continue the list the person was paging through.
  let offset = 0;
  if (slots.more && state?.page) {
    text = normalizeMessage(state.page.question);
    offset = state.page.offset + BASIC_PAGE_SIZE;
  } else if (slots.more) {
    return result(
      'There is no list to continue. Ask for incidents, alerts, runbooks or changes first, then say "show more".',
      'UNKNOWN'
    );
  }

  // A short reply that answers a pending clarification completes the earlier question.
  if (state?.pending && !slots.more) {
    const reply = text.replace(/[?!.]+$/, '').trim();
    const choice = state.pending.choices?.find(
      (option, index) =>
        option.label.toLowerCase() === reply ||
        option.id === reply ||
        reply === String(index + 1) ||
        option.label.toLowerCase().includes(reply)
    );
    // A reply to a free-text request (a resolution note, a note body) is taken as that text unless it is
    // clearly a new question or a command; other replies are new questions when they read as one.
    const standalone =
      state.pending.kind === 'incident'
        ? /\?$/.test(reply) || parseSlashCommand(expanded.message) !== null
        : classifyIntent(text, onIncident).intent !== 'UNKNOWN' && reply.split(' ').length > 3;
    // The completed question keeps the reply's original capitalisation, so names and notes survive.
    let completed: string | null = null;
    if (state.pending.kind === 'intent' && choice?.label) completed = choice.label;
    else if (state.pending.kind === 'service' && !standalone)
      completed = `${state.pending.question} for "${choice?.label ?? expanded.message.trim()}"`;
    else if (state.pending.kind === 'person' && !standalone)
      completed = `${state.pending.question} ${choice?.label ?? expanded.message.trim()}`;
    else if (state.pending.kind === 'incident' && !standalone)
      completed = `${state.pending.question}: ${expanded.message.trim()}`;
    if (completed) {
      text = normalizeMessage(completed);
      slots = { ...extractSlots(text, completed), more: false };
    }
  }

  let prediction = classifyIntent(text, onIncident);
  let intent = prediction.intent;
  const previous = input.previousQuestions?.at(-1);
  const followup =
    /^(and|also|more|tell me more|what else|continue|explain|what about|only|just)\b/i.test(
      expanded.message.trim()
    );
  if (previous && followup && intent === 'UNKNOWN') {
    prediction = classifyIntent(normalizeMessage(previous), onIncident);
    intent = prediction.intent;
  }

  if (incident && (intent === 'GREETING' || intent === 'UNKNOWN'))
    collect?.({ kind: 'incident', id: incident.id, label: incident.title, data: incident });
  if (intent === 'GREETING')
    return result(
      `Hi, I'm ${name}. ${incident ? `I'm looking at ${short(incident.title)}. Ask for a briefing, past fixes or next steps, or say "acknowledge this" to get a confirmation card.` : 'I can check incidents, your work queue, service ownership, on-call coverage, runbooks and follow-up tasks. What would you like to check?'}`,
      'GREETING'
    );
  if (intent === 'THANKS')
    return result(
      incident
        ? 'You’re welcome. I can also check the incident timeline, similar past fixes, or who is on call.'
        : 'You’re welcome. I’m here when you need an incident lookup or an on-call check.',
      'THANKS'
    );
  if (intent === 'HELP') return result(HELP, 'HELP');
  if (intent === 'GUIDANCE') return result(productGuidance(text), 'GUIDANCE');

  // Explicit action requests become proposal cards; the person confirms, the server executes.
  if (slots.action && (incident || slots.incidentRef)) {
    return actionTurn(input, slots, text, now, result, collect);
  }
  if (slots.action && !incident)
    return result(
      'Open the incident you mean, then ask again (for example "acknowledge this"). I only propose actions for the incident on screen, and nothing happens until you confirm the card.',
      'UNKNOWN'
    );

  // Ambiguous: offer the two best readings instead of guessing.
  if (intent === 'UNKNOWN' && prediction.alternatives.length >= 2 && !incident) {
    const choices = prediction.alternatives
      .map(alternative => INTENT_LABEL[alternative.intent])
      .filter((label): label is string => Boolean(label))
      .slice(0, 2);
    if (choices.length === 2)
      return result(
        `I'm not sure which you mean. Did you want "${choices[0]}" or "${choices[1]}"? Pick one, or rephrase.`,
        'UNKNOWN',
        {
          suggestions: choices,
          nextState: pendingState(
            'intent',
            text,
            'UNKNOWN',
            choices.map(label => ({ label })),
            now
          ),
        }
      );
  }

  // Names: a service, team or person mentioned with a typo is matched to the closest one the person can read.
  const options: BasicReadOptions = {
    offset,
    limit: slots.limit,
    groupBy: slots.groupBy,
  };
  let noteLines: string[] = [];
  let question = previous && followup && !slots.more ? mergeBasicQuestion(previous, text) : text;
  if (READ_INTENTS.has(intent)) {
    const resolved = await resolveNames(actor, question, slots, intent, input.page, incident);
    question = resolved.question;
    noteLines = resolved.notes;
    if (resolved.teamIds) options.teamIds = resolved.teamIds;
    if (resolved.assigneeId) options.assigneeId = resolved.assigneeId;
    if (resolved.clarify) {
      return result(resolved.clarify.text, intent, {
        suggestions: resolved.clarify.choices.map(choice => choice.label),
        nextState: pendingState(
          resolved.clarify.kind,
          question,
          intent,
          resolved.clarify.choices,
          now
        ),
      });
    }
    if (input.page?.kind === 'schedule' && intent === 'ON_CALL') options.scheduleId = input.page.id;
    if (input.page?.kind === 'service' && SERVICE_INTENTS.has(intent) && !keywords(question).length)
      options.contextService = input.page.name;
    if (input.page?.kind === 'team' && !options.teamIds && !/\bmy team/.test(question))
      options.teamIds = input.page.teamIds;
  }

  if (READ_INTENTS.has(intent)) {
    const key = `${scopeKey(actor)}|${incident?.id ?? ''}|${input.page?.id ?? ''}|${intent}|${offset}|${question}|${JSON.stringify(options)}`;
    const cached = answerCache.get(key);
    if (cached) {
      cached.snapshots.forEach(snapshot => collect?.(snapshot));
      return finishRead(cached.text, cached.total, cached.hasMore, true);
    }
    const snapshots: EvidenceSnapshot[] = [];
    const read = await answerBasicReadDetailed(
      intent,
      actor,
      question,
      incident,
      source => {
        snapshots.push(source);
        collect?.(source);
      },
      options
    );
    if (read !== null) {
      const text = [...noteLines, read.text].join('\n\n');
      answerCache.set(key, { text, snapshots, total: read.total, hasMore: read.hasMore });
      return finishRead(text, read.total, read.hasMore, false);
    }
  }

  if (!incident)
    return result(
      'I can look up OpsKnight data without an AI provider. Try “My open incidents”, “How many incidents this week by team?”, “Who owns Checkout?”, “Who is on call?”, or “Find checkout incidents since Monday”. Open an incident for a briefing, likely change leads, recorded fixes, runbooks and confirmable actions.',
      'UNKNOWN'
    );
  if (intent === 'TIMELINE') return result(await timeline(incident, collect), 'TIMELINE');
  if (intent === 'UNKNOWN')
    return result(
      `I haven't matched that to a supported lookup yet. For ${short(incident.title)}, try a briefing, similar incidents, causes, runbooks, responders, postmortems, follow-up work or the timeline. You can also ask about service ownership, incident counts or how OpsKnight works, or say "acknowledge this".`,
      'UNKNOWN'
    );
  const requested = incidentIntents(text);
  const sections =
    requested.length > 1
      ? requested.filter(
          section => section !== 'RUNBOOKS' || !requested.includes('INCIDENT_SUMMARY')
        )
      : [intent];
  const answers = await Promise.all(
    sections.map(section => describeIncident(actor, incident, section, collect))
  );
  const freshness = await readIncidentAnalysisState(actor, incident.id).catch(() => null);
  const note =
    freshness?.status === 'CURRENT'
      ? 'Analysis is current.'
      : freshness
        ? `${freshness.message} Suggestions below may be incomplete or out of date.`
        : 'Recommendation freshness could not be verified; check the incident before acting.';
  return result([note, ...answers].join('\n\n'), intent);

  function finishRead(
    text: string,
    total: number | undefined,
    hasMore: boolean | undefined,
    cached: boolean
  ) {
    const nextState = hasMore ? pageState(intent, question, offset, total, now) : null;
    return result(text, intent, {
      cached,
      nextState,
      suggestions: suggestFollowUps({
        intent,
        incident,
        mode: 'basic',
        slots,
        hasMore,
        filters: {
          urgency: /\b(high|medium|low|critical)\b/.test(question),
          window: /\b(today|yesterday|week|month|past|since|between|hours|days)\b/.test(question),
        },
      }),
    });
  }
}

/** A proposal card for an explicit action request. The person still has to confirm it. */
async function actionTurn(
  input: BasicTurnInput,
  slots: Slots,
  text: string,
  now: Date,
  result: (
    text: string,
    intent: SquireIntent,
    extra?: Partial<Omit<BasicTurnResult, 'text' | 'intent'>>
  ) => BasicTurnResult,
  collect?: Collect
): Promise<BasicTurnResult> {
  const { actor, incident } = input;
  if (!incident) return result('Open the incident you mean first.', 'UNKNOWN');
  collect?.({ kind: 'incident', id: incident.id, label: incident.title, data: incident });
  const confirm = 'Nothing happens until you confirm the card below.';
  switch (slots.action) {
    case 'acknowledge':
      if (incident.status !== 'OPEN')
        return result(
          `${short(incident.title)} is ${incident.status.toLowerCase()}, so there is nothing to acknowledge.`,
          'RESPONDERS'
        );
      return result(
        `I can propose acknowledging ${short(incident.title)}. ${confirm}`,
        'RESPONDERS',
        {
          proposals: [{ action: 'acknowledge_incident', input: { incidentId: incident.id } }],
        }
      );
    case 'resolve': {
      const resolution = slots.actionText?.trim() ?? '';
      if (incident.status === 'RESOLVED')
        return result(`${short(incident.title)} is already resolved.`, 'RESPONDERS');
      if (resolution.length < 10)
        return result(
          'What fixed it? Reply with a resolution note of at least 10 characters and I will prepare the card.',
          'RESPONDERS',
          {
            nextState: pendingState(
              'incident',
              'resolve this incident',
              'RESPONDERS',
              undefined,
              now
            ),
            suggestions: [],
          }
        );
      return result(
        `I can propose resolving ${short(incident.title)} with that note. ${confirm}`,
        'RESPONDERS',
        {
          proposals: [
            {
              action: 'resolve_incident',
              input: { incidentId: incident.id, resolution: resolution.slice(0, 1000) },
            },
          ],
        }
      );
    }
    case 'note': {
      const content = slots.actionText?.trim() ?? '';
      if (!content)
        return result(
          'What should the note say? Reply with the text and I will prepare the card.',
          'RESPONDERS',
          {
            nextState: pendingState('incident', 'add a note', 'RESPONDERS', undefined, now),
            suggestions: [],
          }
        );
      return result(
        `I can propose adding that note to ${short(incident.title)}. ${confirm}`,
        'RESPONDERS',
        {
          proposals: [
            {
              action: 'add_incident_note',
              input: { incidentId: incident.id, content: content.slice(0, 2000) },
            },
          ],
        }
      );
    }
    case 'reassign': {
      const who =
        slots.person && slots.person !== 'me'
          ? slots.person
          : slots.actionText?.replace(/^(to|it to)\s+/i, '').trim();
      if (slots.person === 'me')
        return result(
          `I can propose assigning ${short(incident.title)} to you. ${confirm}`,
          'RESPONDERS',
          {
            proposals: [
              {
                action: 'reassign_incident',
                input: { incidentId: incident.id, assigneeId: actor.id },
              },
            ],
          }
        );
      if (!who)
        return result('Who should take it? Reply with a name.', 'RESPONDERS', {
          nextState: pendingState('person', 'assign this to', 'RESPONDERS', undefined, now),
          suggestions: [],
        });
      const people = (await resolveEntities(actor, who, ['person'])).slice(0, 5);
      const match = confidentMatch(people, 'person');
      if (match)
        return result(
          `I can propose assigning ${short(incident.title)} to ${match.name}. ${confirm}`,
          'RESPONDERS',
          {
            proposals: [
              {
                action: 'reassign_incident',
                input: { incidentId: incident.id, assigneeId: match.id },
              },
            ],
          }
        );
      if (people.length === 0)
        return result(
          `I could not find an active person matching “${short(who)}” that you can see. Try their full name.`,
          'RESPONDERS'
        );
      return result(
        `Several people match “${short(who)}”. Who do you mean?\n${people.map((person, index) => `${index + 1}. ${person.name}`).join('\n')}`,
        'RESPONDERS',
        {
          suggestions: people.map(person => person.name).slice(0, 4),
          nextState: pendingState(
            'person',
            'assign this to',
            'RESPONDERS',
            people.map(person => ({ label: person.name, id: person.id })),
            now
          ),
        }
      );
    }
    case 'link': {
      const other = slots.incidentRef && slots.incidentRef !== 'current' ? slots.incidentRef : null;
      if (!other)
        return result(
          'Which incident should it be linked to? Include its id, for example "link to incident cm…".',
          'RESPONDERS'
        );
      if (!(await readIncidentForActor(actor, other)))
        return result('I could not find that incident in what you can read.', 'RESPONDERS');
      return result(
        `I can propose marking ${short(incident.title)} as related to ${other}. ${confirm}`,
        'RESPONDERS',
        {
          proposals: [
            {
              action: 'link_related_incident',
              input: { incidentId: incident.id, otherIncidentId: other },
            },
          ],
        }
      );
    }
    case 'snooze':
      return result(
        `Snoozing is done from the incident page, where you choose a duration and a reason: /incidents/${incident.id}. I can prepare acknowledge, resolve, note and reassign cards here.`,
        'RESPONDERS'
      );
    default:
      return result(text, 'UNKNOWN');
  }
}

/** Resolves typed names to visible services, teams and people; asks when several are plausible. */
async function resolveNames(
  actor: AuthorizationActor,
  question: string,
  slots: Slots,
  intent: SquireIntent,
  page: ResolvedPageContext | null | undefined,
  incident: ReadableIncident | null
): Promise<{
  question: string;
  notes: string[];
  teamIds?: string[];
  assigneeId?: string;
  clarify?: {
    kind: 'service' | 'person';
    text: string;
    choices: Array<{ label: string; id?: string }>;
  };
}> {
  const notes: string[] = [];
  let resolvedQuestion = question;
  let teamIds: string[] | undefined;
  let assigneeId: string | undefined;
  if (slots.team) {
    const teams = await resolveEntities(actor, slots.team, ['team']);
    const team = confidentMatch(teams, 'team');
    if (team) {
      teamIds = [team.id];
      if (team.name.toLowerCase() !== slots.team.toLowerCase())
        notes.push(`Showing the ${team.name} team (you typed “${short(slots.team)}”).`);
      resolvedQuestion = resolvedQuestion.replace(slots.team, '').replace(/\bteam\b/, '');
    } else if (teams.length === 0)
      notes.push(
        `No team matching “${short(slots.team)}” is visible to you; showing all visible teams.`
      );
  }
  if (
    slots.person &&
    slots.person !== 'me' &&
    (intent === 'WORK_QUEUE' || intent === 'SEARCH_INCIDENTS' || intent === 'ACTIVE_INCIDENTS')
  ) {
    const people = await resolveEntities(actor, slots.person, ['person']);
    const person = confidentMatch(people, 'person');
    if (person) {
      assigneeId = person.id;
      notes.push(`Incidents assigned to ${person.name}.`);
      // The question is normalised to lower case; the name is removed so it is not also a keyword.
      resolvedQuestion = resolvedQuestion.replace(slots.person.toLowerCase(), '');
    } else if (people.length > 1)
      return {
        question,
        notes,
        clarify: {
          kind: 'person',
          text: `Several people match “${short(slots.person)}”. Who do you mean?\n${people
            .slice(0, 5)
            .map((p, i) => `${i + 1}. ${p.name}`)
            .join('\n')}`,
          choices: people.slice(0, 5).map(p => ({ label: p.name, id: p.id })),
        },
      };
  }
  if (SERVICE_INTENTS.has(intent) && !/["“]/.test(resolvedQuestion)) {
    const terms = keywords(resolvedQuestion).filter(
      term => term.length >= 2 && !/^\d+$/.test(term)
    );
    // A name that matches several visible services is a question to ask, not a guess to make. The
    // choices are remembered so the next short reply ("Payments API", or "2") completes the question.
    if ((intent === 'SERVICE_HEALTH' || intent === 'ON_CALL') && terms.length && !page) {
      const candidates = await prisma.service.findMany({
        where: {
          AND: [
            serviceReadWhere(actor),
            ...terms.map(term => ({ name: { contains: term, mode: 'insensitive' as const } })),
          ],
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: 6,
        select: { id: true, name: true },
      });
      const joined = terms.join(' ');
      const exact = candidates.find(row => row.name.toLowerCase() === joined);
      if (candidates.length > 1 && !exact && !incident)
        return {
          question,
          notes,
          clarify: {
            kind: 'service',
            text: `Several services match. Which one do you mean?\n${candidates
              .slice(0, 5)
              .map((row, i) => `${i + 1}. ${row.name}`)
              .join('\n')}`,
            choices: candidates.slice(0, 5).map(row => ({ label: row.name, id: row.id })),
          },
        };
      if (exact) resolvedQuestion = `${resolvedQuestion} "${exact.name}"`;
    }
    // A misspelt multi-word name ("chekout api") is matched as a whole phrase first.
    const words = terms.filter(term => term.length >= 2);
    if (words.length > 1) {
      const all = await prisma.service.count({
        where: {
          AND: [
            serviceReadWhere(actor),
            ...words.map(term => ({ name: { contains: term, mode: 'insensitive' as const } })),
          ],
        },
      });
      if (all === 0) {
        const phrase = words.join(' ');
        const match = confidentMatch(await resolveEntities(actor, phrase, ['service']), 'service');
        if (match) {
          for (const term of words) resolvedQuestion = resolvedQuestion.replace(term, '');
          resolvedQuestion = `${resolvedQuestion} "${match.name}"`;
          notes.push(`Showing results for ${match.name} (you typed “${short(phrase)}”).`);
          return {
            question: resolvedQuestion.replace(/\s+/g, ' ').trim(),
            notes,
            teamIds,
            assigneeId,
          };
        }
      }
    }
    for (const term of terms.filter(term => term.length >= 3).slice(0, 2)) {
      if (
        incident?.serviceName.toLowerCase().includes(term) ||
        page?.name.toLowerCase().includes(term)
      )
        continue;
      const exact = await prisma.service.count({
        where: {
          AND: [serviceReadWhere(actor), { name: { contains: term, mode: 'insensitive' } }],
        },
      });
      if (exact > 0) continue;
      const services = await resolveEntities(actor, term, ['service']);
      const match = confidentMatch(services, 'service');
      if (match) {
        resolvedQuestion = resolvedQuestion.replace(term, `"${match.name}"`);
        notes.push(`Showing results for ${match.name} (you typed “${short(term)}”).`);
      } else if (services.length > 1 && (intent === 'SERVICE_HEALTH' || intent === 'ON_CALL'))
        return {
          question,
          notes,
          clarify: {
            kind: 'service',
            text: `Did you mean one of these services?\n${services
              .slice(0, 5)
              .map((s, i) => `${i + 1}. ${s.name}`)
              .join('\n')}`,
            choices: services.slice(0, 5).map(s => ({ label: s.name, id: s.id })),
          },
        };
    }
  }
  return { question: resolvedQuestion.replace(/\s+/g, ' ').trim(), notes, teamIds, assigneeId };
}

/** Deterministic answers use source facts and fixed investigation templates, never a model. */
export async function answerDeterministically(
  actor: AuthorizationActor,
  message: string,
  incident: ReadableIncident | null,
  collect?: Collect,
  options: { name?: string; previousQuestions?: readonly string[] } = {}
): Promise<string> {
  return (
    await planBasicTurn(
      {
        actor,
        message,
        incident,
        name: options.name,
        previousQuestions: options.previousQuestions,
      },
      collect
    )
  ).text;
}

export { routeIntent };
export type { EntityMatch };
