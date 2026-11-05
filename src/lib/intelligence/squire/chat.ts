import { readIncidentAnalysisState } from '../analysis/view';
import { SquireEvidenceRegistry, type EvidenceSnapshot } from './evidence';
import { mintContextProof, readBrowserContext, authorizationContextHash } from './context-proof';
import type { SourceReference } from '../conversations/contract';
import { readAlertReference, readChangeReference } from './references';
import 'server-only';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { incidentReadWhere, runbookReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { registerAiGateway } from '../ai/gateway';
import {
  resolveLanguageModel,
  highestDataClass,
  type AiMessage,
  type LanguageModelPort,
  type AiDataClass,
} from '../ai/port';
import { getAiSettings } from '../ai/settings';
import { getGuidance } from '../ai/prompts';
import { getHistoryStatus, type ConversationDetail } from '../conversations/store';
import { getConversationForActor } from '../conversations/view';
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
  semantic_search_incidents: 'Searching incidents by meaning',
  get_status_page: 'Reading the status page',
  get_problem_outcomes: 'Checking past outcomes for this problem',
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
    if (
      actor.apiKey ||
      actor.status !== 'ACTIVE' ||
      !hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_SUGGESTIONS_READ)
    ) {
      yield { type: 'error', message: 'You do not have access to the assistant.' };
      return;
    }

    let savedConversation: ConversationDetail | null = null;
    if (request.conversationId && (await getHistoryStatus()).enabled) {
      const saved = await getConversationForActor(actor, request.conversationId);
      savedConversation = saved;
      if (!saved) {
        yield {
          type: 'error',
          message: 'That conversation is not available. Start a new conversation to continue.',
        };
        return;
      }
      if (saved && saved.incidentId !== (incident?.id ?? null)) {
        yield {
          type: 'error',
          message:
            'This conversation belongs to a different context. Open its incident or start a new conversation.',
        };
        return;
      }
    }

    registerAiGateway();
    // These reads depend only on the authenticated actor and readable incident, not provider selection.
    // Start them together so provider discovery does not add serial database round trips.
    const preparation = settings.enabled
      ? Promise.all([
          incident ? brief(actor, incident) : Promise.resolve(null),
          getGuidance('squire.system').catch(() => null),
          priorTurns(actor, request, savedConversation, incident?.id ?? null),
        ])
      : Promise.resolve(null);
    // Free-text questions and history may identify people, even without personal-data tools.
    // Legacy and browser messages have no trusted classification: require Personal clearance
    // for the entire turn rather than silently downgrading their classification on fallback.
    const [briefing, guidance, context] = (await preparation) ?? [
      null,
      null,
      { messages: [] as AiMessage[], omitted: false },
    ];
    const history = context.messages;
    if (context.omitted)
      yield {
        type: 'notice',
        text: 'Some earlier answers were omitted because their context could not be verified. Ask about the current evidence again if needed.',
      };
    const dataClass = highestDataClass(['PERSONAL', ...history.map(message => message.dataClass)]);
    let port: LanguageModelPort | null = null;
    if (settings.enabled) {
      port = await resolveLanguageModel('SQUIRE_CHAT', dataClass);
    }

    if (port) {
      yield { type: 'meta', mode: 'ai', name: settings.squireName };
      const evidence = new SquireEvidenceRegistry(actor, dataClass);
      const prepared = briefing ? await evidence.briefing(briefing) : null;
      const prompt = buildSystemPrompt(settings.squireName, prepared, guidance);
      const messages: AiMessage[] = [
        { role: 'system', content: prompt.system, dataClass: 'PERSONAL' },
        ...history,
        { role: 'user', content: request.message, dataClass: 'PERSONAL' },
      ];

      let answer = '';
      let proposals = 0;
      let failed = false;
      const emittedCoverage = new Set<string>();
      for await (const event of port.stream({
        context: {
          actorId: actor.id,
          capability: 'SQUIRE_CHAT',
          dataClass,
          incidentId: incident?.id,
          signal,
          prompt: prompt.meta,
        },
        messages,
        tools: buildSquireTools(actor, {
          personal: true,
          dataClass,
          signal,
          observe: (name, input, result) => evidence.observe(name, input, result),
        }),
        maxSteps: SQUIRE_LIMITS.maxSteps,
      })) {
        for (const text of evidence.notices()) {
          if (!emittedCoverage.has(text)) {
            emittedCoverage.add(text);
            yield { type: 'notice', text };
          }
        }
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
          yield* basicAnswer(actor, request, incident, settings.squireName, dataClass);
          return;
        }
      }
      if (failed) return;
      // The model can spend its whole step budget on tools and end without a word; never answer with nothing.
      if (!answer.trim() && proposals === 0) {
        yield { type: 'notice', text: 'I could not finish that answer. Here is what I know.' };
        yield* basicAnswer(actor, request, incident, settings.squireName, dataClass);
        return;
      }
      const citations = evidence.citations(answer);
      if (citations.length > 0) yield { type: 'citations', items: citations };
      yield { type: 'suggestions', items: followUps(incident, true) };
      yield {
        type: 'memory',
        turn: {
          mode: 'ai',
          dataClass,
          completion: 'COMPLETED',
          sources: evidence.sources(),
          verified: evidence.verified,
          authorizationHash: authorizationContextHash(actor),
        },
      };
      yield await contextProofs(
        actor,
        { ...request, incidentId: incident?.id },
        answer,
        dataClass,
        evidence.sources(),
        evidence.verified
      );
      yield { type: 'done' };
      return;
    }

    if (settings.enabled) {
      yield {
        type: 'notice',
        text: `AI conversation requires a provider permitted to receive ${dataClass === 'SENSITIVE' ? 'Sensitive' : 'Personal'} data. Showing a basic answer.`,
      };
    }
    yield* basicAnswer(actor, request, incident, settings.squireName, dataClass);
  } catch (error) {
    if (signal?.aborted) return;
    logger.error('[Squire] Turn failed', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    yield { type: 'error', message: 'Something went wrong. Please try again.' };
  }
}

async function* basicAnswer(
  actor: AuthorizationActor,
  request: SquireRequest,
  incident: ReadableIncident | null,
  name: string,
  dataClass: AiDataClass = 'PERSONAL'
): AsyncGenerator<SquireEvent> {
  yield { type: 'meta', mode: 'basic', name };
  const evidence = new SquireEvidenceRegistry(actor, dataClass);
  const snapshots: EvidenceSnapshot[] = [];
  const answer = await answerDeterministically(actor, request.message, incident, source =>
    snapshots.push(source)
  );
  const readable = await evidence.capture(snapshots);
  const text = readable
    ? answer
    : 'The source changed or became unavailable. Please ask for a fresh answer.';
  yield* typed(text);
  const citations = evidence.citations(text);
  if (citations.length > 0) yield { type: 'citations', items: citations };
  yield { type: 'suggestions', items: followUps(incident, false) };
  yield {
    type: 'memory',
    turn: {
      mode: 'basic',
      dataClass,
      completion: 'COMPLETED',
      sources: evidence.sources(),
      verified: evidence.verified,
      authorizationHash: authorizationContextHash(actor),
    },
  };
  yield await contextProofs(
    actor,
    { ...request, incidentId: incident?.id },
    text,
    dataClass,
    evidence.sources(),
    evidence.verified
  );
  yield { type: 'done' };
}

/** The incident on screen with its top intelligence, read through the person's own visibility. */
async function brief(
  actor: AuthorizationActor,
  incident: ReadableIncident
): Promise<IncidentBriefing> {
  const [similar, response, events, analysis] = await Promise.all([
    getSimilarIncidentsForActor(incident.id, actor).catch(() => null),
    getResponseIntelligenceForActor(incident.id, actor).catch(() => null),
    prisma.incidentEvent
      .findMany({
        where: { incidentId: incident.id },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: { type: true, createdAt: true, message: true },
      })
      .catch(() => []),
    readIncidentAnalysisState(actor, incident.id).catch(() => null),
  ]);
  return {
    incident,
    analysis: analysis
      ? {
          status: analysis.status,
          message: analysis.message,
          lastSuccessfulAt: analysis.lastSuccessfulAt,
        }
      : { status: 'UNAVAILABLE', message: 'Recommendation freshness could not be verified.' },
    timeline: events.map(event => ({
      type: event.type ?? 'EVENT',
      at: event.createdAt.toISOString(),
      summary: event.message.slice(0, 240),
    })),
    similar: (similar ?? []).slice(0, 3).map(s => ({
      id: s.incidentId,
      title: s.title,
      matchPercent: s.matchPercent,
      status: s.status,
    })),
    changes: (response?.changes ?? []).slice(0, 3).map(c => ({
      id: c.changeId,
      summary: c.summary,
      kind: c.kind,
      minutesBeforeOnset: c.leadMinutes,
    })),
    runbooks: (response?.runbooks ?? []).slice(0, 3).map(r => ({
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
async function priorTurns(
  actor: AuthorizationActor,
  request: SquireRequest,
  saved: ConversationDetail | null,
  incidentId: string | null
): Promise<{ messages: AiMessage[]; omitted: boolean }> {
  if (saved) {
    const turns = saved.messages.slice(-SQUIRE_LIMITS.historyMax);
    const replayable = turns.filter(
      message =>
        message.role === 'user' ||
        (message.replayable !== false &&
          message.envelope?.verified &&
          message.envelope.completion === 'COMPLETED')
    );
    return {
      messages: replayable.map(message => ({
        role: message.role,
        content:
          message.role === 'assistant'
            ? `[Saved answer recorded ${message.createdAt.toISOString()}; verify current facts with tools.]\n${message.content.slice(0, SQUIRE_LIMITS.historyTurnMax)}`
            : message.content.slice(0, SQUIRE_LIMITS.historyTurnMax),
        dataClass: message.dataClass,
      })),
      omitted: replayable.length !== turns.length,
    };
  }
  return readBrowserContext(actor, incidentId, request.history);
}

async function contextProofs(
  actor: AuthorizationActor,
  request: SquireRequest,
  answer: string,
  dataClass: AiDataClass,
  sources?: SourceReference[],
  verified = false
): Promise<Extract<SquireEvent, { type: 'context' }>> {
  const [userProof, assistantProof] = await Promise.all([
    mintContextProof({
      actor,
      incidentId: request.incidentId,
      role: 'user',
      text: request.message,
      dataClass,
    }).catch(() => undefined),
    verified
      ? mintContextProof({
          actor,
          incidentId: request.incidentId,
          role: 'assistant',
          text: answer,
          dataClass,
          sources,
        }).catch(() => undefined)
      : undefined,
  ]);
  return {
    type: 'context',
    ...(userProof ? { userProof } : {}),
    ...(assistantProof ? { assistantProof } : {}),
  };
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
  const changeIds = ids(/\/changes\/([A-Za-z0-9_-]{1,64})/g);
  const alertIds = ids(/\/alerts\/([A-Za-z0-9_-]{1,64})/g);
  if (incidentIds.length + runbookIds.length + changeIds.length + alertIds.length === 0) return [];
  const [incidents, runbooks, changes, alerts] = await Promise.all([
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
    Promise.all(changeIds.map(id => readChangeReference(actor, id).catch(() => null))),
    Promise.all(alertIds.map(id => readAlertReference(actor, id).catch(() => null))),
  ]);
  const byIncident = new Map(incidents.map(row => [row.id, row.title]));
  const byRunbook = new Map(runbooks.map(row => [row.id, row.name]));
  return [
    ...changes.flatMap(row =>
      row
        ? [{ kind: 'change' as const, id: row.id, label: row.summary, href: `/changes/${row.id}` }]
        : []
    ),
    ...alerts.flatMap(row =>
      row
        ? [{ kind: 'alert' as const, id: row.id, label: row.summary, href: `/alerts/${row.id}` }]
        : []
    ),
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
