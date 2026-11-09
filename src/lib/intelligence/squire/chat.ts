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
import { redactSecrets } from '../ai/redact';
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
  planBasicTurn,
  readIncidentForActor,
  resolvePageContext,
  type ReadableIncident,
  type ResolvedPageContext,
} from './deterministic';
import { readDialogueState, writeDialogueState } from '../assistant/dialogue-state';
import { suggestFollowUps } from './basic/suggestions';
import { buildSystemPrompt, type IncidentBriefing } from './prompt';
import { actionForTool, buildSquireTools, SQUIRE_TOOL_DATA_CLASS } from './tools';
import { OBSERVABILITY_TOOL_LABELS } from './tools-observability';
import { listEligibleConnections } from '../connectors/service';
import { INCIDENT_TOOL_LABELS } from './tools-incident';
import { summarizeOlderTurns } from './context-summary';
import { wantsInvestigation } from './investigation/classify';
import { portFor, streamInvestigation } from './investigation/turn';

/** Evidence handles a basic answer may carry; beyond this the answer is paged rather than refused. */
const MAX_BASIC_SOURCES = 32;

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
  ...OBSERVABILITY_TOOL_LABELS,
  ...INCIDENT_TOOL_LABELS,
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
    const [settings, requestedIncident, page] = await Promise.all([
      getAiSettings(),
      request.incidentId ? readIncidentForActor(actor, request.incidentId) : Promise.resolve(null),
      resolvePageContext(actor, request.pageContext),
    ]);
    // An alert page is its incident's page, when the person may read that incident.
    const incident =
      requestedIncident ??
      (page?.incidentId ? await readIncidentForActor(actor, page.incidentId) : null);
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
      yield {
        type: 'meta',
        mode: 'ai',
        name: settings.squireName,
        ...(incident?.status === 'OPEN' && incident.urgency === 'HIGH' ? { attention: true } : {}),
      };
      const evidence = new SquireEvidenceRegistry(actor, dataClass);
      const prepared = briefing ? await evidence.briefing(briefing) : null;
      // Observability connectors are optional: a lookup failure only means their tools are not offered.
      const observability = await listEligibleConnections(actor).catch(() => []);
      const prompt = buildSystemPrompt(settings.squireName, prepared, guidance);
      const messages: AiMessage[] = [
        { role: 'system', content: prompt.system, dataClass: 'PERSONAL' },
        ...history,
        { role: 'user', content: request.message, dataClass: 'PERSONAL' },
      ];

      // ---- Investigation mode (off unless an administrator enables it) ----
      const investigationContext = {
        actorId: actor.id,
        dataClass,
        incidentId: incident?.id,
        signal,
        prompt: prompt.meta,
      };
      if (
        settings.squireInvestigationEnabled &&
        (await wantsInvestigation(request.message, {
          onIncident: Boolean(incident),
          classifier: () => portFor('CLASSIFY', dataClass, port!),
          context: investigationContext,
          dataClass,
        }))
      ) {
        yield* streamInvestigation({
          actor,
          question: request.message,
          preamble: messages.slice(0, -1),
          context: investigationContext,
          dataClass,
          chatPort: port,
          settings,
          evidence,
          labels: TOOL_LABELS,
          suggestions: followUps(incident, true),
          verifiedHash: authorizationContextHash(actor),
          finish: answer =>
            contextProofs(
              actor,
              { ...request, incidentId: incident?.id },
              answer,
              dataClass,
              evidence.sources(),
              evidence.verified
            ),
          fallback: () =>
            basicAnswer(
              actor,
              request,
              incident,
              settings.squireName,
              dataClass,
              savedConversation,
              'unavailable',
              page
            ),
        });
        return;
      }

      let answer = '';
      let proposals = 0;
      let failed = false;
      // The classes of the tools that actually ran decide what the saved turn is classified as, and
      // whether a proposal was made after reading third-party text (alerts, notes, payloads).
      const ranClasses: AiDataClass[] = [];
      let readUntrusted = false;
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
          extendedActions: settings.squireExtendedActions,
          dataClass,
          signal,
          observability,
          observe: (name, input, result) => {
            // eslint-disable-next-line security/detect-object-injection -- lookup in a fixed table; unknown names fall back
            ranClasses.push(SQUIRE_TOOL_DATA_CLASS[name] ?? 'INTERNAL');
            readUntrusted = true;
            return evidence.observe(name, input, result);
          },
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
            yield {
              type: 'proposal',
              proposal: { ...proposal, ...(readUntrusted ? { untrustedContext: true } : {}) },
            };
          }
        } else if (event.type === 'error') {
          if (answer || proposals > 0) {
            yield {
              type: 'error',
              message: event.message,
              availability: /budget|quota|too many/i.test(event.message) ? 'quota' : 'unavailable',
            };
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
          yield* basicAnswer(
            actor,
            request,
            incident,
            settings.squireName,
            dataClass,
            savedConversation,
            /budget|quota|too many/i.test(event.message) ? 'quota' : 'unavailable',
            page
          );
          return;
        }
      }
      if (failed) return;
      // The model can spend its whole step budget on tools and end without a word; never answer with nothing.
      if (!answer.trim() && proposals === 0) {
        yield { type: 'notice', text: 'I could not finish that answer. Here is what I know.' };
        yield* basicAnswer(
          actor,
          request,
          incident,
          settings.squireName,
          dataClass,
          savedConversation,
          'ready',
          page
        );
        return;
      }
      const citations = evidence.citations(answer);
      if (citations.length > 0) yield { type: 'citations', items: citations };
      yield { type: 'suggestions', items: followUps(incident, true) };
      yield {
        type: 'memory',
        turn: {
          mode: 'ai',
          dataClass: highestDataClass([dataClass, ...ranClasses]),
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
    yield* basicAnswer(
      actor,
      request,
      incident,
      settings.squireName,
      dataClass,
      savedConversation,
      settings.enabled ? 'unavailable' : 'disabled',
      page
    );
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
  dataClass: AiDataClass = 'PERSONAL',
  savedConversation: ConversationDetail | null = null,
  availability: 'ready' | 'disabled' | 'quota' | 'unavailable' = 'disabled',
  page: ResolvedPageContext | null = null
): AsyncGenerator<SquireEvent> {
  const scope = {
    userId: actor.id,
    conversationId: savedConversation?.id,
    incidentId: incident?.id ?? null,
  };
  const state = await readDialogueState(scope).catch(() => null);
  const evidence = new SquireEvidenceRegistry(actor, dataClass);
  const snapshots: EvidenceSnapshot[] = [];
  const plan = await planBasicTurn(
    {
      actor,
      message: request.message,
      incident,
      page,
      state,
      name,
      // Earlier user questions supply intent only. Every answer is rebuilt from fresh scoped data.
      previousQuestions: (savedConversation?.messages ?? request.history)
        .filter(turn => turn.role === 'user')
        .slice(-3)
        .map(turn => turn.content),
    },
    source => snapshots.push(source)
  );
  yield {
    type: 'meta',
    mode: 'basic',
    name,
    availability,
    intent: plan.intent,
    ...(incident?.status === 'OPEN' && incident.urgency === 'HIGH' ? { attention: true } : {}),
  };
  // A wide answer cites its first sources rather than being withheld; the rest is reachable by narrowing.
  const paged = snapshots.length > MAX_BASIC_SOURCES;
  const readable = await evidence.capture(
    paged ? snapshots.slice(0, MAX_BASIC_SOURCES) : snapshots
  );
  const templateOnly =
    snapshots.length === 0 &&
    ['HELP', 'GREETING', 'THANKS', 'GUIDANCE', 'UNKNOWN', 'RESPONDERS'].includes(plan.intent);
  const verified = Boolean(readable) && (evidence.verified || templateOnly);
  const text = readable
    ? redactSecrets(
        paged
          ? `${plan.text}\n\nThis answer touched more than ${MAX_BASIC_SOURCES} records; only the first ${MAX_BASIC_SOURCES} are cited. Narrow the question (a service, a status or a shorter window) for complete citations.`
          : plan.text
      )
    : 'The source changed or became unavailable. Please ask for a fresh answer.';
  yield* typed(text);
  const citations = evidence.citations(text);
  if (citations.length > 0) yield { type: 'citations', items: citations };
  let proposed = 0;
  for (const requestProposal of plan.proposals.slice(0, MAX_PROPOSALS)) {
    const proposal = await buildProposal(
      actor,
      requestProposal.action,
      requestProposal.input
    ).catch(() => null);
    if (proposal) {
      proposed += 1;
      yield { type: 'proposal', proposal };
    }
  }
  if (plan.proposals.length > 0 && proposed === 0)
    yield {
      type: 'notice',
      text: 'That action is not available for this incident right now (it may have changed, or you may not have permission).',
    };
  yield { type: 'suggestions', items: plan.suggestions };
  await writeDialogueState({ ...scope, state: plan.nextState }).catch(() => undefined);
  yield {
    type: 'memory',
    turn: {
      mode: 'basic',
      dataClass,
      completion: 'COMPLETED',
      sources: evidence.sources(),
      verified,
      authorizationHash: authorizationContextHash(actor),
    },
  };
  yield await contextProofs(
    actor,
    { ...request, incidentId: incident?.id },
    text,
    dataClass,
    evidence.sources(),
    verified
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
    const isReplayable = (message: ConversationDetail['messages'][number]) =>
      message.role === 'user' ||
      (message.replayable !== false &&
        message.envelope?.verified &&
        message.envelope.completion === 'COMPLETED');
    const replayable = turns.filter(isReplayable);
    // Turns before the replay window are summarised (pinned after the system prompt), not dropped.
    const summary = await summarizeOlderTurns(
      saved.messages.slice(0, -SQUIRE_LIMITS.historyMax).filter(isReplayable),
      {
        actorId: actor.id,
        incidentId: incidentId ?? undefined,
        resolve: dataClass => resolveLanguageModel('SUMMARIZE', dataClass),
      }
    ).catch(() => null);
    return {
      messages: [
        ...(summary ? [summary] : []),
        ...replayable.map(message => ({
          role: message.role,
          content:
            message.role === 'assistant'
              ? `[Saved answer recorded ${message.createdAt.toISOString()}; verify current facts with tools.]\n${message.content.slice(0, SQUIRE_LIMITS.historyTurnMax)}`
              : message.content.slice(0, SQUIRE_LIMITS.historyTurnMax),
          dataClass: message.dataClass,
        })),
      ],
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
  return suggestFollowUps({ intent: 'UNKNOWN', incident, mode: ai ? 'ai' : 'basic' });
}
