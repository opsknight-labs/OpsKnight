import 'server-only';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { incidentReadWhere, runbookReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { registerAiGateway } from '../ai/gateway';
import { resolveLanguageModel, type AiMessage, type LanguageModelPort } from '../ai/port';
import { getAiSettings } from '../ai/settings';
import { getGuidance } from '../ai/prompts';
import { getConversation, getHistoryStatus } from '../conversations/store';
import { getResponseIntelligenceForActor } from '../response/view';
import { getSimilarIncidentsForActor } from '../similarity/view';
import { buildProposal } from './actions/proposals';
import {
  SQUIRE_LIMITS,
  type SquireCitation,
  type SquireEvent,
  type SquireRequest,
} from './contract';
import {
  answerDeterministically,
  readIncidentForActor,
  type ReadableIncident,
} from './deterministic';
import { buildSystemPrompt, type IncidentBriefing } from './prompt';
import { actionForTool, buildSquireTools } from './tools';

const CHUNK = 48;
const MAX_PROPOSALS = 2;
const MAX_CITATIONS = 8;

async function* typed(text: string): AsyncGenerator<SquireEvent> {
  for (let i = 0; i < text.length; i += CHUNK)
    yield { type: 'delta', text: text.slice(i, i + CHUNK) };
}

/** What the person sees while the assistant looks something up. */
const TOOL_LABELS: Record<string, string> = {
  search_incidents: 'Searching incidents',
  get_incident: 'Reading the incident',
  get_intelligence: 'Checking similar incidents and likely causes',
  get_service: 'Reading the service',
  get_recent_changes: 'Checking recent changes',
  get_runbook: 'Reading the runbook',
  search_postmortems: 'Searching postmortems',
  get_timeline: 'Reading the timeline',
  list_alerts: 'Reading the alerts',
  who_is_on_call: 'Checking who is on call',
  find_people: 'Looking up people',
};

/**
 * One Squire turn as a stream of events. It never throws: any failure becomes an `error` or a graceful fall
 * back to the basic (no-AI) answer, so a model outage degrades the assistant rather than breaking it.
 * Unreadable or unknown incident ids are dropped silently so they cannot be probed.
 */
export async function* streamSquire(
  actor: AuthorizationActor,
  request: SquireRequest,
  signal?: AbortSignal
): AsyncGenerator<SquireEvent> {
  try {
    const [settings, incident] = await Promise.all([
      getAiSettings(),
      request.incidentId ? readIncidentForActor(actor, request.incidentId) : Promise.resolve(null),
    ]);
    if (!settings.squireEnabled) {
      yield { type: 'error', message: 'The assistant is turned off.' };
      return;
    }
    if (!hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_SUGGESTIONS_READ)) {
      yield { type: 'error', message: 'You do not have access to the assistant.' };
      return;
    }

    registerAiGateway();
    // Prefer a provider allowed to receive Personal data (timelines and on-call answers name people); fall
    // back to one allowed Internal data, which then gets no tools that return people's details.
    let port: LanguageModelPort | null = null;
    let personal = false;
    if (settings.enabled) {
      port = await resolveLanguageModel('SQUIRE_CHAT', 'PERSONAL');
      personal = port !== null;
      port ??= await resolveLanguageModel('SQUIRE_CHAT', 'INTERNAL');
    }

    if (port) {
      yield { type: 'meta', mode: 'ai', name: settings.squireName };
      const [briefing, guidance, history] = await Promise.all([
        incident ? brief(actor, incident) : Promise.resolve(null),
        getGuidance('squire.system'),
        priorTurns(actor, request),
      ]);
      const prompt = buildSystemPrompt(settings.squireName, briefing, guidance);
      const messages: AiMessage[] = [
        { role: 'system', content: prompt.system },
        ...history,
        { role: 'user', content: request.message },
      ];

      let answer = '';
      let proposals = 0;
      let failed = false;
      for await (const event of port.stream({
        context: {
          actorId: actor.id,
          capability: 'SQUIRE_CHAT',
          dataClass: personal ? 'PERSONAL' : 'INTERNAL',
          incidentId: incident?.id,
          signal,
          prompt: prompt.meta,
        },
        messages,
        tools: buildSquireTools(actor, { personal }),
        maxSteps: SQUIRE_LIMITS.maxSteps,
      })) {
        if (event.type === 'text-delta') {
          answer += event.delta;
          yield { type: 'delta', text: event.delta };
        } else if (event.type === 'tool-start') {
          const label = TOOL_LABELS[event.name];
          if (label) yield { type: 'tool', label };
        } else if (event.type === 'tool-call') {
          const action = actionForTool(event.call.name);
          if (!action || proposals >= MAX_PROPOSALS) continue;
          const proposal = await buildProposal(actor, action, event.call.input).catch(() => null);
          if (proposal) {
            proposals += 1;
            yield { type: 'proposal', proposal };
          }
        } else if (event.type === 'error') {
          if (answer || proposals > 0) {
            yield { type: 'error', message: event.message };
            failed = true;
            break;
          }
          // Nothing shown yet: answer from the intelligence data instead.
          yield {
            type: 'notice',
            text:
              event.retryable && /Too many|budget/i.test(event.message)
                ? `${event.message}. Showing a basic answer.`
                : 'AI is unavailable right now. Showing a basic answer.',
          };
          yield* basicAnswer(actor, request, incident, settings.squireName);
          return;
        }
      }
      if (failed) return;
      // The model can spend its whole step budget on tools and end without a word; never answer with nothing.
      if (!answer.trim() && proposals === 0) {
        yield { type: 'notice', text: 'I could not finish that answer. Here is what I know.' };
        yield* typed(await answerDeterministically(actor, request.message, incident));
      }
      const citations = await citationsFor(actor, answer);
      if (citations.length > 0) yield { type: 'citations', items: citations };
      yield { type: 'suggestions', items: followUps(incident, true) };
      yield { type: 'done' };
      return;
    }

    yield* basicAnswer(actor, request, incident, settings.squireName);
  } catch (error) {
    if (signal?.aborted) return;
    logger.error('[Squire] Turn failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    yield { type: 'error', message: 'Something went wrong. Please try again.' };
  }
}

async function* basicAnswer(
  actor: AuthorizationActor,
  request: SquireRequest,
  incident: ReadableIncident | null,
  name: string
): AsyncGenerator<SquireEvent> {
  yield { type: 'meta', mode: 'basic', name };
  const text = await answerDeterministically(actor, request.message, incident);
  yield* typed(text);
  const citations = await citationsFor(actor, text);
  if (citations.length > 0) yield { type: 'citations', items: citations };
  yield { type: 'suggestions', items: followUps(incident, false) };
  yield { type: 'done' };
}

/** The incident on screen with its top intelligence, read through the person's own visibility. */
async function brief(
  actor: AuthorizationActor,
  incident: ReadableIncident
): Promise<IncidentBriefing> {
  const [similar, response] = await Promise.all([
    getSimilarIncidentsForActor(incident.id, actor).catch(() => null),
    getResponseIntelligenceForActor(incident.id, actor).catch(() => null),
  ]);
  return {
    incident,
    similar: (similar ?? [])
      .slice(0, 3)
      .map(s => ({
        id: s.incidentId,
        title: s.title,
        matchPercent: s.matchPercent,
        status: s.status,
      })),
    changes: (response?.changes ?? [])
      .slice(0, 3)
      .map(c => ({ summary: c.summary, kind: c.kind, minutesBeforeOnset: c.leadMinutes })),
    runbooks: (response?.runbooks ?? [])
      .slice(0, 3)
      .map(r => ({
        id: r.runbookId,
        name: r.name,
        succeeded: r.succeeded,
        completedRuns: r.eligible,
      })),
  };
}

/**
 * Earlier turns. A saved conversation is the source of truth when history is on (the person's own, read
 * on the server); otherwise the browser's copy is used, already trimmed by the request schema.
 */
async function priorTurns(actor: AuthorizationActor, request: SquireRequest): Promise<AiMessage[]> {
  if (request.conversationId) {
    const status = await getHistoryStatus().catch(() => ({ enabled: false }));
    if (status.enabled) {
      const saved = await getConversation(actor.id, request.conversationId).catch(() => null);
      if (saved) {
        return saved.messages
          .slice(-SQUIRE_LIMITS.historyMax)
          .map(message => ({
            role: message.role,
            content: message.content.slice(0, SQUIRE_LIMITS.historyTurnMax),
          }));
      }
    }
  }
  return request.history.map(turn => ({ role: turn.role, content: turn.content }));
}

/**
 * Incidents and runbooks the answer points at, each checked against the person's own visibility, so a
 * citation is only ever shown for something they can open (and a hallucinated id simply disappears).
 */
export async function citationsFor(
  actor: AuthorizationActor,
  text: string
): Promise<SquireCitation[]> {
  const ids = (pattern: RegExp) =>
    [...new Set([...text.matchAll(pattern)].map(match => match[1]))].slice(0, MAX_CITATIONS);
  const incidentIds = ids(/\/incidents\/([A-Za-z0-9_-]{1,64})/g);
  const runbookIds = ids(/\/runbooks\/([A-Za-z0-9_-]{1,64})/g);
  if (incidentIds.length + runbookIds.length === 0) return [];
  const [incidents, runbooks] = await Promise.all([
    incidentIds.length === 0
      ? Promise.resolve([])
      : prisma.incident
          .findMany({
            where: { AND: [{ id: { in: incidentIds } }, incidentReadWhere(actor)] },
            select: { id: true, title: true },
          })
          .catch(() => []),
    runbookIds.length === 0
      ? Promise.resolve([])
      : prisma.runbook
          .findMany({
            where: { AND: [{ id: { in: runbookIds }, archivedAt: null }, runbookReadWhere(actor)] },
            select: { id: true, name: true },
          })
          .catch(() => []),
  ]);
  const byIncident = new Map(incidents.map(row => [row.id, row.title]));
  const byRunbook = new Map(runbooks.map(row => [row.id, row.name]));
  return [
    ...incidentIds
      .filter(id => byIncident.has(id))
      .map(id => ({
        kind: 'incident' as const,
        id,
        label: byIncident.get(id)!,
        href: `/incidents/${id}`,
      })),
    ...runbookIds
      .filter(id => byRunbook.has(id))
      .map(id => ({
        kind: 'runbook' as const,
        id,
        label: byRunbook.get(id)!,
        href: `/runbooks/${id}`,
      })),
  ].slice(0, MAX_CITATIONS);
}

/** Next questions worth asking, from the page context. Deterministic, so they cost nothing. */
export function followUps(incident: ReadableIncident | null, ai: boolean): string[] {
  if (!incident)
    return [
      'What is on fire right now?',
      'Who is on call?',
      ...(ai ? ['Any incidents like this in the last week?'] : []),
    ];
  if (incident.status === 'RESOLVED') {
    return [
      'Have we seen this before?',
      ...(ai ? ['Summarise what happened', 'Draft the postmortem'] : ['Which runbook fits?']),
    ];
  }
  return [
    'What changed before this started?',
    'Have we seen this before?',
    ...(ai ? ['Who is on call for this?', 'Draft a status update note'] : ['Which runbook fits?']),
  ];
}
