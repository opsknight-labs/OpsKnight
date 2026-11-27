import { readIncidentAnalysisState } from '../analysis/view';
import { SquireEvidenceRegistry, type EvidenceSnapshot } from './evidence';
import {
  mintContextProof,
  readBrowserContext,
  authorizationContextHash,
  earlierAnswerLabel,
} from './context-proof';
import type { SourceReference } from '../conversations/contract';
import { readAlertReference, readChangeReference } from './references';
import 'server-only';
import { z } from 'zod/v4';
import prisma from '@/lib/prisma';
import { getUserTimeZone } from '@/lib/timezone';
import { logger } from '@/lib/logger';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { incidentReadWhere, runbookReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { registerAiGateway } from '../ai/gateway';
import {
  resolveLanguageModel,
  highestDataClass,
  dataClassAllows,
  type AiMessage,
  type AiToolDefinition,
  type LanguageModelPort,
  type AiDataClass,
} from '../ai/port';
import { redactPersonalData, redactSecrets } from '../ai/redact';
import { AI_LEAN_NOTICE } from '../ai/contract';
import { getAiSettings, type AiSettingsView } from '../ai/settings';
import { getGuidance } from '../ai/prompts';
import type { ConversationDetail } from '../conversations/store';
import { getConversationForActor } from '../conversations/view';
import { getPinnedBriefingForActor } from './briefing-view';
import { buildProposal } from './actions/proposals';
import {
  AI_PROVIDER_LABELS,
  SQUIRE_CHART_LIMITS,
  SQUIRE_LIMITS,
  aiLimitFrom,
  type SquireChart,
  type SquireAiLimit,
  type SquireCitation,
  type SquireEvent,
  type SquireRequest,
  type SquireTrace,
} from './contract';
import {
  mentionedIncident,
  planBasicTurn,
  readIncidentForActor,
  resolvePageContext,
  type ReadableIncident,
  type ResolvedPageContext,
} from './deterministic';
import { aboutUserLines, mentionLine, viewingLine } from './about';
import { resolveMentions } from './mentions';
import { traceReadTool, traceTurn } from './tracing';
import {
  argsSchema,
  buildOperationProposal,
  buildOperationTools,
  mayCall,
  PROPOSE_OPERATION_TOOL,
  rolesAllowing,
  squireOperation,
} from './operations';
import {
  buildPlanProposal,
  buildRunbookFromFixProposal,
  buildRunbookStepsProposal,
  PROPOSE_PLAN_TOOL,
  PROPOSE_RUNBOOK_FROM_FIX_TOOL,
  PROPOSE_RUNBOOK_STEPS_TOOL,
  PROPOSE_RUNBOOK_PUBLISH_TOOL,
  buildRunbookPublishProposal,
  runbookPublishInput,
  runbookFromFixInput,
  runbookStepsInput,
} from './plans';
import { buildRememberProposal, memoriesForPrompt, REMEMBER_FACT_TOOL } from './memory';
import {
  detectEntityReferences,
  entityHintsForPrompt,
  resolveEntityReferences,
} from './entity-refs';
import { readDialogueState, writeDialogueState } from '../assistant/dialogue-state';
import { suggestFollowUps } from './basic/suggestions';
import type { SquireIntent } from './intents';
import { buildSystemPrompt, type IncidentBriefing } from './prompt';
import { actionForTool, buildSquireTools, SQUIRE_TOOL_DATA_CLASS } from './tools';
import {
  metricsChart,
  splitChartSamples,
  OBSERVABILITY_TOOL_DATA_CLASS,
  OBSERVABILITY_TOOL_LABELS,
  OBSERVABILITY_TOOL_NAMES,
} from './tools-observability';
import { listEligibleConnections } from '../connectors/service';
import { INCIDENT_TOOL_LABELS } from './tools-incident';
import { summarizeOlderTurns } from './context-summary';
import { wantsInvestigation } from './investigation/classify';
import { portFor, streamInvestigation } from './investigation/turn';
import { squireKnowledgeEnabled } from '../memory/settings';

/** Evidence handles a basic answer may carry; beyond this the answer is paged rather than refused. */
/** Marks where the person's own request starts, after the on-screen data. */
const PERSON_MESSAGE_LABEL =
  "The person's message (theirs: this is the request to answer, not data):";

const MAX_BASIC_SOURCES = 32;

const CHUNK = 48;
const MAX_PROPOSALS = 2;
const PROPOSAL_CAP_NOTICE = `Only the first ${MAX_PROPOSALS} suggested actions are shown. Ask again for the others.`;
const PROPOSAL_DROPPED_NOTICE =
  'A suggested action could not be shown: it may no longer apply, or you may not have permission for it.';
const BUDGET_CUT_NOTICE =
  'The AI budget did not allow more lookups, so this answer is written from what was read so far.';

/** Mirrors plans.ts's input schema: a title and two to five operation steps. */
const planInput = z
  .object({ title: z.string().trim().min(1).max(120), steps: z.array(argsSchema).min(2).max(5) })
  .strict();

/** The extended proposal tools, each validated like its card builder, so a malformed call is refused at once. */
const PROPOSAL_EXTRA_TOOLS: AiToolDefinition[] = [
  { ...PROPOSE_OPERATION_TOOL, validate: input => argsSchema.safeParse(input).success },
  { ...PROPOSE_PLAN_TOOL, validate: input => planInput.safeParse(input).success },
  {
    ...PROPOSE_RUNBOOK_FROM_FIX_TOOL,
    validate: input => runbookFromFixInput.safeParse(input).success,
  },
  {
    ...PROPOSE_RUNBOOK_STEPS_TOOL,
    validate: input => runbookStepsInput.safeParse(input).success,
  },
  {
    ...PROPOSE_RUNBOOK_PUBLISH_TOOL,
    validate: input => runbookPublishInput.safeParse(input).success,
  },
];
const MAX_CITATIONS = 8;
/** A tool argument that carries no free text: an id or number (has a digit), a time, or an UPPER_CASE enum. A bare word is text. */
const PLAIN_VALUE = /^(?:[A-Z][A-Z0-9_]{0,63}|[A-Za-z0-9_.:-]{0,63}\d[A-Za-z0-9_.:-]{0,63})$/;

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
  search_product_docs: 'Searching the OpsKnight docs',
  get_catch_up: 'Catching you up',
  find_operations: 'Looking for the right operation',
  describe_operation: 'Checking what the operation needs',
  read_operation: 'Reading from OpsKnight',
  ...OBSERVABILITY_TOOL_LABELS,
  ...INCIDENT_TOOL_LABELS,
  get_automation_decision: 'Checking why automation routed it',
  explain_automation_rule: 'Reading the automation rule',
};

/**
 * Narrows the tools a turn may use below the person's own permissions, for surfaces that act for a
 * narrower principal (an MCP connection limited by its granted scopes). Unset means every tool.
 */
export interface SquireTurnScope {
  /**
   * When set, the only READ tools offered to the model or the investigation planner in this turn
   * (proposal tools are unaffected: they only describe a change the person confirms in OpsKnight).
   */
  readTools?: ReadonlySet<string>;
}

/** Whether the turn may use any of these read tools. */
function mayRead(scope: SquireTurnScope, ...names: string[]): boolean {
  return !scope.readTools || names.some(name => scope.readTools!.has(name));
}

/**
 * The read tools that back each basic-mode intent: a scoped turn gets the basic answer only when one of them is
 * allowed. Template intents (help, greetings, guidance) read nothing and are always allowed.
 */
const BASIC_INTENT_READS: Partial<Record<SquireIntent, readonly string[]>> = {
  WORK_QUEUE: ['search_incidents'],
  ACTIVE_INCIDENTS: ['search_incidents'],
  SEARCH_INCIDENTS: ['search_incidents', 'semantic_search_incidents'],
  ALERT_STATS: ['list_alerts', 'incident_analytics'],
  INCIDENT_STATS: ['incident_analytics'],
  SERVICE_HEALTH: ['get_service'],
  RUNBOOK_SEARCH: ['get_runbook'],
  RUNBOOKS: ['get_intelligence', 'get_runbook'],
  RECENT_CHANGES: ['get_recent_changes'],
  FOLLOWUPS: ['search_postmortems'],
  POSTMORTEMS: ['search_postmortems'],
  RESPONDERS: ['who_is_on_call', 'find_people'],
  ON_CALL: ['who_is_on_call'],
  TIMELINE: ['get_timeline'],
  SIMILAR: ['get_intelligence'],
  CAUSES: ['get_intelligence', 'get_recent_changes'],
  INCIDENT_SUMMARY: ['get_incident'],
  CATCH_UP: ['get_catch_up'],
};

export function basicIntentAllowed(scope: SquireTurnScope, intent: SquireIntent): boolean {
  // eslint-disable-next-line security/detect-object-injection -- intent is a member of the closed intent union
  const reads = BASIC_INTENT_READS[intent];
  return !reads || mayRead(scope, ...reads);
}

const BASIC_SCOPE_REFUSAL =
  'This connection is not allowed to read what that question needs. Ask in OpsKnight, or ask an administrator to grant the matching access.';

/**
 * One Squire turn as a stream of events. It never throws: any failure becomes an `error` or a graceful fall
 * back to the basic (no-AI) answer, so a model outage degrades the assistant rather than breaking it.
 * Unreadable or unknown incident ids are dropped silently so they cannot be probed.
 */
export function streamSquire(
  actor: AuthorizationActor,
  request: SquireRequest,
  signal?: AbortSignal,
  scope: SquireTurnScope = {}
): AsyncGenerator<SquireEvent> {
  const served: ServedTrace = {};
  return traceTurn(withTrace(squireTurn(actor, request, signal, scope, served), served), signal);
}

/** What the AI answer's model call reported, for the trace. */
type ServedTrace = Pick<SquireTrace, 'model' | 'provider' | 'tokens'>;

/**
 * Passes a turn's events through and, just before `done`, sends how the answer was made. Built from the
 * events themselves, so every path (AI, investigation, basic) gets one; model and tokens come from `served`.
 */
export async function* withTrace(
  events: AsyncGenerator<SquireEvent>,
  served: ServedTrace,
  startedAt = Date.now()
): AsyncGenerator<SquireEvent> {
  let mode: SquireTrace['mode'] = 'basic';
  let verified = false;
  let sources: string[] = [];
  const tools = new Set<string>();
  for await (const event of events) {
    if (event.type === 'meta') mode = event.mode;
    else if (event.type === 'tool') tools.add(event.label);
    else if (event.type === 'investigation')
      for (const call of event.step.calls) tools.add(call.label);
    else if (event.type === 'citations') sources = event.items.map(item => item.label);
    else if (event.type === 'memory') verified = event.turn.verified === true;
    else if (event.type === 'done')
      yield {
        type: 'trace',
        trace: {
          mode,
          tools: [...tools].slice(0, 24).map(label => label.slice(0, 200)),
          sources: sources.slice(0, 8).map(label => label.slice(0, 200)),
          // A basic answer after a failed or empty model call was not written by that model.
          ...(mode === 'ai' ? served : {}),
          durationMs: Date.now() - startedAt,
          verified,
        },
      };
    yield event;
  }
}

async function* squireTurn(
  actor: AuthorizationActor,
  request: SquireRequest,
  signal: AbortSignal | undefined,
  scope: SquireTurnScope,
  served: ServedTrace = {}
): AsyncGenerator<SquireEvent> {
  try {
    const reading = getAiSettings();
    const [settings, requestedIncident, page, mentioned, savedRead] = await Promise.all([
      reading,
      request.incidentId ? readIncidentForActor(actor, request.incidentId) : Promise.resolve(null),
      resolvePageContext(actor, request.pageContext),
      resolveMentions(actor, request.mentions),
      // The saved conversation starts with the other reads, reusing the settings read (undefined: not asked).
      request.conversationId
        ? reading.then(loaded =>
            loaded.squireHistoryEnabled
              ? getConversationForActor(actor, request.conversationId!, loaded)
              : undefined
          )
        : Promise.resolve(undefined),
    ]);
    // An alert or postmortem page is its incident's page, when the person may read that incident.
    // A question that names an incident by id or link ("what's going on with incident <id>") is about it, when
    // the person may read it: its briefing is loaded up front as on its page.
    const named = !request.incidentId ? mentionedIncident(request.message) : null;
    const incident =
      requestedIncident ??
      (named ? await readIncidentForActor(actor, named.id).catch(() => null) : null) ??
      (page?.incidentId ? await readIncidentForActor(actor, page.incidentId) : null);
    // Basic answers have no model to read mention lines: one mentioned record, asked off any page, is the page.
    const sole = !incident && !page && mentioned.length === 1 ? mentioned[0] : undefined;
    const basicIncident = incident ?? sole?.incident ?? null;
    const basicPage = page ?? sole?.page ?? null;
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

    const savedConversation: ConversationDetail | null = savedRead ?? null;
    if (savedRead === null) {
      yield {
        type: 'error',
        message: 'That conversation is not available. Start a new conversation to continue.',
      };
      return;
    }

    registerAiGateway();
    // These reads depend only on the authenticated actor and readable incident, not provider selection.
    // Start them together so provider discovery does not add serial database round trips.
    const preparation = settings.enabled
      ? Promise.all([
          incident ? brief(actor, incident, settings) : Promise.resolve(null),
          getGuidance('squire.system').catch(() => null),
          priorTurns(actor, request, savedConversation, incident?.id ?? null),
          // Answers state times in the person's zone, as basic answers do.
          prisma.user
            .findUnique({ where: { id: actor.id }, select: { timeZone: true, name: true } })
            .catch(() => null),
          prisma.team
            .findMany({
              where: { id: { in: [...actor.teamIds] } },
              select: { name: true },
              orderBy: { name: 'asc' },
              take: 20,
            })
            .catch(() => []),
          // Knowledge memory (F4): a failed settings read simply leaves the knowledge tools out.
          squireKnowledgeEnabled().catch(() => false),
          // Observability connectors are optional: a lookup failure only means their tools are not offered.
          mayRead(scope, ...OBSERVABILITY_TOOL_NAMES)
            ? listEligibleConnections(actor).catch(() => [])
            : Promise.resolve([]),
          // A conversation turn is at least Personal; resolved now, and again only if history raises it.
          resolveLanguageModel('SQUIRE_CHAT', 'PERSONAL'),
        ])
      : Promise.resolve(null);
    const [briefing, guidance, context, viewer, teams, knowledge, observability, personalPort] =
      (await preparation) ?? [
        null,
        null,
        { messages: [], omitted: false } as PriorTurns,
        null,
        [],
        false,
        [],
        null,
      ];
    // No notice for omitted earlier turns: once one exists it repeated on every later turn, and the person
    // can do nothing about it. A saved conversation keeps a placeholder in its place (priorTurns).
    const history = context.messages;
    // A conversation turn is Personal: free text can name people and customers, and redaction only removes
    // emails, phones and IPs. Without a provider cleared for Personal data the turn gets a basic answer.
    const historyClass = highestDataClass([
      'INTERNAL',
      ...history.map(message => message.dataClass),
    ]);
    const dataClass: AiDataClass = highestDataClass(['PERSONAL', historyClass]);
    const port: LanguageModelPort | null = !settings.enabled
      ? null
      : dataClass === 'PERSONAL'
        ? personalPort
        : await resolveLanguageModel('SQUIRE_CHAT', dataClass);
    const personal = dataClassAllows(dataClass, 'PERSONAL');
    const question = personal ? request.message : redactPersonalData(request.message);
    // Remembered facts are personal data: only for a provider cleared for it, and never fatal.
    const memories = port && personal ? await memoriesForPrompt(actor.id).catch(() => []) : [];
    // Records the question names by link, id or name, each loaded only if the person may read it.
    const hints = port
      ? entityHintsForPrompt(
          await resolveEntityReferences(actor, detectEntityReferences(request.message)).catch(
            () => []
          ),
          { personal }
        )
      : '';

    if (port) {
      yield {
        type: 'meta',
        mode: 'ai',
        name: settings.squireName,
        ...(incident?.status === 'OPEN' && incident.urgency === 'HIGH' ? { attention: true } : {}),
      };
      const evidence = new SquireEvidenceRegistry(actor, dataClass);
      // Charts come from what a read tool really returned, on both the ordinary and investigation paths
      // (both read through the registry), and only when this turn's data class may show that tool's data.
      const charts: SquireChart[] = [];
      const observeEvidence = evidence.observe.bind(evidence);
      evidence.observe = async (name, input, result, maxBytes) => {
        // Dense chart points never reach the model; they are kept here for the chart only.
        const { forModel, dense } = splitChartSamples(result);
        const observed = await observeEvidence(name, input, forModel, maxBytes);
        // eslint-disable-next-line security/detect-object-injection -- lookup in a fixed table; unknown names never chart
        const toolClass = OBSERVABILITY_TOOL_DATA_CLASS[name];
        // Only a result the registry captured as evidence (`{ data, evidence }`) is drawn.
        const captured = (observed as { data?: unknown } | null)?.data;
        const chart =
          charts.length < SQUIRE_CHART_LIMITS.perTurn &&
          toolClass &&
          dataClassAllows(dataClass, toolClass)
            ? metricsChart(name, captured, dense)
            : null;
        if (chart) charts.push(chart);
        return observed;
      };
      const prepared = briefing
        ? await evidence.briefing(
            personal ? briefing : { ...briefing, summary: undefined, timeline: undefined }
          )
        : null;
      const prompt = buildSystemPrompt(
        settings.squireName,
        prepared,
        guidance,
        getUserTimeZone(viewer ?? undefined),
        new Date(),
        {
          user: aboutUserLines({
            role: actor.role,
            // A name is personal data: only sent to a provider cleared for it.
            firstName: personal ? viewer?.name?.trim().split(/\s+/)[0] : null,
            teams: teams.map(team => team.name),
            memories,
          }),
          ...(page && !incident ? { viewing: viewingLine(page) } : {}),
          // A person's name is personal data, like the first name above.
          mentions: [
            ...mentioned.filter(mention => personal || mention.kind !== 'person').map(mentionLine),
            ...(hints ? [hints] : []),
          ],
        }
      );
      const system: AiMessage = { role: 'system', content: prompt.system, dataClass };
      // The parts of the briefing that change between turns, sent after the cached prefix.
      const volatile: AiMessage[] = prompt.volatile
        ? [{ role: 'user', content: prompt.volatile, dataClass }]
        : [];

      const chatPort = port;
      // The ordinary AI answer: the model with tools. Also what an investigation falls back to when its
      // planner fails before reading anything, so a basic answer never replaces an available model.
      const ordinary = async function* (): AsyncGenerator<SquireEvent> {
        const replay = personal
          ? history
          : history
              // Questions only: no earlier answers, and no summary of them.
              .filter(message => message.role === 'user' && message !== context.summary)
              .map(message => ({
                ...message,
                content: redactPersonalData(message.content),
                dataClass: 'INTERNAL' as const,
              }));
        const messages: AiMessage[] = [
          system,
          // The history is append-only, so the next turn sends it again unchanged: cache up to its end.
          ...replay.map((message, index) =>
            index === replay.length - 1 ? { ...message, cache: true } : message
          ),
          {
            role: 'user',
            // One turn: the on-screen data first, labelled as data, then the person's own words, labelled as
            // theirs. Providers merge consecutive user messages anyway, and the model must still be able to tell
            // the data (which can quote hostile text) from the request it has to answer.
            content: volatile.length
              ? `${volatile[0]!.content}\n\n${PERSON_MESSAGE_LABEL}\n${question}`
              : question,
            dataClass,
          },
        ];
        let answer = '';
        let proposals = 0;
        let droppedNotice = false;
        let failed = false;
        // The classes of the tools that actually ran decide what the saved turn is classified as, and
        // whether a proposal was made after reading third-party text (alerts, notes, payloads).
        const ranClasses: AiDataClass[] = [];
        let readUntrusted = false;
        // Only a card whose text could come from what was read carries the warning: ids, enums, times and
        // text the person typed themselves do not.
        const typed = [...history, { content: question }]
          .filter(message => !('role' in message) || message.role === 'user')
          .map(message => String(message.content).toLowerCase())
          .join('\n');
        const freeText = (value: unknown): boolean =>
          typeof value === 'string'
            ? !PLAIN_VALUE.test(value) && !typed.includes(value.trim().toLowerCase())
            : Array.isArray(value)
              ? value.some(freeText)
              : value && typeof value === 'object'
                ? Object.values(value).some(freeText)
                : false;
        const untrustedFlag = (card: { untrustedContext?: boolean }, input: unknown) =>
          card.untrustedContext || (readUntrusted && freeText(input))
            ? { untrustedContext: true }
            : {};
        // Text before a tool call and text after it are separate paragraphs, never glued together.
        let stepEnded = false;
        const emittedCoverage = new Set<string>();
        for await (const event of chatPort.stream({
          context: {
            actorId: actor.id,
            capability: 'SQUIRE_CHAT',
            callSite: 'interactive' as const,
            dataClass,
            incidentId: incident?.id,
            signal,
            prompt: prompt.meta,
          },
          messages,
          // The same tools in the same order every turn (not narrowed per question), so the cached prefix holds.
          tools: buildSquireTools(actor, {
            personal,
            extendedActions: settings.squireExtendedActions,
            knowledge,
            dataClass,
            signal,
            observability,
            // The operation catalog: reads for everyone, changes (confirmable cards) with extended actions.
            extraTools: [
              ...buildOperationTools(actor, { signal }),
              ...(settings.squireExtendedActions ? PROPOSAL_EXTRA_TOOLS : []),
              REMEMBER_FACT_TOOL,
            ],
            observe: (name, input, result) => {
              // eslint-disable-next-line security/detect-object-injection -- lookup in a fixed table; unknown names fall back
              ranClasses.push(SQUIRE_TOOL_DATA_CLASS[name] ?? 'INTERNAL');
              readUntrusted = true;
              return evidence.observe(name, input, result);
            },
          })
            .filter(tool => tool.kind !== 'READ' || mayRead(scope, tool.name))
            .map(traceReadTool),
          maxSteps: SQUIRE_LIMITS.maxSteps,
        })) {
          for (const text of evidence.notices()) {
            if (!emittedCoverage.has(text)) {
              emittedCoverage.add(text);
              yield { type: 'notice', text };
            }
          }
          if (event.type === 'text-delta') {
            const text =
              stepEnded && answer.trim() && !/\s$/.test(answer)
                ? `\n\n${event.delta}`
                : event.delta;
            stepEnded = false;
            answer += text;
            yield { type: 'delta', text };
          } else if (event.type === 'finish') {
            const { usage, served: by } = event.result;
            Object.assign(served, {
              model: by.model,
              ...(by.kind ? { provider: AI_PROVIDER_LABELS[by.kind] ?? by.kind } : {}),
              tokens: {
                input: usage.inputTokens,
                output: usage.outputTokens,
                ...(usage.cacheReadTokens ? { cacheRead: usage.cacheReadTokens } : {}),
              },
            });
            if (event.result.degraded) yield { type: 'notice', text: AI_LEAN_NOTICE };
            if (event.result.budgetLimited) yield { type: 'notice', text: BUDGET_CUT_NOTICE };
          } else if (event.type === 'tool-start') {
            stepEnded = true;
            const label = TOOL_LABELS[event.name];
            if (label) yield { type: 'tool', label };
          } else if (event.type === 'tool-call') {
            stepEnded = true;
            const action = actionForTool(event.call.name);
            const operation = event.call.name === PROPOSE_OPERATION_TOOL.name;
            const plan = event.call.name === PROPOSE_PLAN_TOOL.name;
            const remember = event.call.name === REMEMBER_FACT_TOOL.name;
            const fix = event.call.name === PROPOSE_RUNBOOK_FROM_FIX_TOOL.name;
            const runbookPublish = event.call.name === PROPOSE_RUNBOOK_PUBLISH_TOOL.name;
            const runbookSteps =
              runbookPublish || event.call.name === PROPOSE_RUNBOOK_STEPS_TOOL.name;
            if (!action && !operation && !plan && !remember && !fix && !runbookSteps) continue;
            // The model was told a card is shown only if still valid: say so when one is not.
            if (proposals >= MAX_PROPOSALS) {
              if (!droppedNotice) yield { type: 'notice', text: PROPOSAL_CAP_NOTICE };
              droppedNotice = true;
              continue;
            }
            if (fix || runbookSteps) {
              // These cards refuse with a reason (role needed, not resolved, no draft): say it, not a generic drop.
              const builder = fix
                ? buildRunbookFromFixProposal
                : runbookPublish
                  ? buildRunbookPublishProposal
                  : buildRunbookStepsProposal;
              const built = await builder(actor, event.call.input).catch(() => null);
              if (built && 'token' in built) {
                proposals += 1;
                yield {
                  type: 'proposal',
                  proposal: { ...built, ...untrustedFlag(built, event.call.input) },
                };
              } else yield { type: 'notice', text: built?.refusal ?? PROPOSAL_DROPPED_NOTICE };
              continue;
            }
            const proposal = await (
              remember
                ? buildRememberProposal(actor, event.call.input)
                : plan
                  ? buildPlanProposal(actor, event.call.input)
                  : operation
                    ? buildOperationProposal(actor, event.call.input)
                    : buildProposal(actor, action!, event.call.input)
            ).catch(() => null);
            if (proposal) {
              proposals += 1;
              yield {
                type: 'proposal',
                proposal: { ...proposal, ...untrustedFlag(proposal, event.call.input) },
              };
            } else if (!droppedNotice) {
              droppedNotice = true;
              yield { type: 'notice', text: PROPOSAL_DROPPED_NOTICE };
            }
          } else if (event.type === 'error') {
            const limit = aiLimitFrom(event.message);
            if (answer || proposals > 0) {
              yield {
                type: 'error',
                message: event.message,
                availability: limit ? 'quota' : 'unavailable',
                ...(limit ? { limit } : {}),
              };
              failed = true;
              break;
            }
            // Nothing shown yet: answer from the intelligence data instead.
            yield {
              type: 'notice',
              // A limit says which one, whether or not the gateway marked it retryable: "unavailable" misleads.
              text:
                limit === 'rate'
                  ? 'You have reached the per-minute AI limit. Showing a basic answer; try again in a minute.'
                  : limit === 'budget'
                    ? "Today's AI budget is used up. Showing a basic answer."
                    : 'AI is unavailable right now. Showing a basic answer.',
            };
            yield* basicAnswer(
              actor,
              request,
              basicIncident,
              settings.squireName,
              dataClass,
              savedConversation,
              limit ? 'quota' : 'unavailable',
              basicPage,
              limit,
              undefined,
              scope
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
            basicIncident,
            settings.squireName,
            dataClass,
            savedConversation,
            'ready',
            basicPage,
            undefined,
            undefined,
            scope
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
      };

      // ---- Investigation mode (off unless an administrator enables it) ----
      const investigationContext = {
        actorId: actor.id,
        callSite: 'interactive' as const,
        dataClass,
        incidentId: incident?.id,
        signal,
        prompt: prompt.meta,
      };
      if (
        settings.squireInvestigationEnabled &&
        (await wantsInvestigation(question, {
          onIncident: Boolean(incident),
          classifier: () => portFor('CLASSIFY', dataClass, port!),
          context: investigationContext,
          dataClass,
        }))
      ) {
        yield* withCharts(
          charts,
          streamInvestigation({
            actor,
            question,
            // Only the final diagnosis reads this (the planner has its own prompt): the system prompt and
            // the current briefing, without the chat history.
            preamble: [system, ...volatile],
            context: investigationContext,
            dataClass,
            chatPort: port,
            settings,
            evidence,
            labels: TOOL_LABELS,
            suggestions: followUps(incident, true),
            verifiedHash: authorizationContextHash(actor),
            observability,
            knowledge,
            ...(scope.readTools ? { readTools: scope.readTools } : {}),
            finish: answer =>
              contextProofs(
                actor,
                { ...request, incidentId: incident?.id },
                answer,
                dataClass,
                evidence.sources(),
                evidence.verified
              ),
            fallback: ordinary,
          })
        );
        return;
      }

      yield* withCharts(charts, ordinary());
      return;
    }

    // Provider policy, not a passing failure: the reason rides on the meta event (shown once, in the banner).
    yield* basicAnswer(
      actor,
      request,
      basicIncident,
      settings.squireName,
      dataClass,
      savedConversation,
      settings.enabled ? 'unavailable' : 'disabled',
      basicPage,
      undefined,
      settings.enabled
        ? dataClass === 'SENSITIVE'
          ? 'No AI provider is allowed to receive Sensitive data, which this conversation holds'
          : 'No enabled AI provider is allowed to receive Internal data'
        : undefined,
      scope
    );
  } catch (error) {
    if (signal?.aborted) return;
    logger.error('[Squire] Turn failed', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    yield { type: 'error', message: 'Something went wrong. Please try again.' };
  }
}

/** Why a slash-command change produced no card, in words the person can act on. */
/**
 * Passes a turn's events through, sending each chart collected since the last event before the next one, and
 * saving the charts with the turn so a reopened conversation still shows them.
 */
export async function* withCharts(
  charts: readonly SquireChart[],
  events: AsyncGenerator<SquireEvent>
): AsyncGenerator<SquireEvent> {
  let sent = 0;
  for await (const event of events) {
    while (sent < charts.length) yield { type: 'chart', chart: charts[sent++] };
    yield event.type === 'memory' && charts.length > 0
      ? { ...event, turn: { ...event.turn, charts: [...charts] } }
      : event;
  }
}

async function operationRefusal(actor: AuthorizationActor, operationId: string): Promise<string> {
  const settings = await getAiSettings().catch(() => null);
  if (!settings?.squireExtendedActions)
    return 'That change is not available: an administrator has not turned on "Extended assistant actions" in the AI settings. Nothing was prepared.';
  const operation = squireOperation(operationId);
  if (!operation) return 'That change is not available from Squire. Nothing was prepared.';
  if (!mayCall(actor, operation))
    return `You don't have permission for that change: it needs ${rolesAllowing(actor, operation)}. Ask someone with that role, or an administrator to change your role. Nothing was prepared.`;
  return 'That change is not available right now (the target may have changed or be out of your reach). Nothing was prepared.';
}

async function* basicAnswer(
  actor: AuthorizationActor,
  request: SquireRequest,
  incident: ReadableIncident | null,
  name: string,
  dataClass: AiDataClass = 'PERSONAL',
  savedConversation: ConversationDetail | null = null,
  availability: 'ready' | 'disabled' | 'quota' | 'unavailable' = 'disabled',
  page: ResolvedPageContext | null = null,
  limit?: SquireAiLimit,
  reason?: string,
  turnScope: SquireTurnScope = {}
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
    ...(limit ? { limit } : {}),
    ...(reason ? { reason } : {}),
    intent: plan.intent,
    ...(incident?.status === 'OPEN' && incident.urgency === 'HIGH' ? { attention: true } : {}),
  };
  // A narrower principal (an MCP connection, a shared channel) gets no basic answer its read tools could not.
  if (!basicIntentAllowed(turnScope, plan.intent)) {
    const text = BASIC_SCOPE_REFUSAL;
    yield* typed(text);
    yield { type: 'suggestions', items: [] };
    yield {
      type: 'memory',
      turn: {
        mode: 'basic',
        dataClass,
        completion: 'COMPLETED',
        sources: [],
        verified: false,
        authorizationHash: authorizationContextHash(actor),
      },
    };
    yield await contextProofs(actor, { ...request, incidentId: incident?.id }, text, dataClass);
    yield { type: 'done' };
    return;
  }
  // A wide answer cites its first sources rather than being withheld; the rest is reachable by narrowing.
  const paged = snapshots.length > MAX_BASIC_SOURCES;
  const readable = await evidence.capture(
    paged ? snapshots.slice(0, MAX_BASIC_SOURCES) : snapshots
  );
  // A slash-command change is built before the text, so a refusal replaces the "I can propose" line.
  const operationCard = plan.operation
    ? await buildOperationProposal(actor, plan.operation).catch(() => null)
    : null;
  const refusal =
    plan.operation && !operationCard
      ? await operationRefusal(actor, plan.operation.operationId)
      : null;
  const templateOnly =
    snapshots.length === 0 &&
    (Boolean(plan.operation) ||
      ['HELP', 'GREETING', 'THANKS', 'GUIDANCE', 'UNKNOWN', 'RESPONDERS'].includes(plan.intent));
  const verified = Boolean(readable) && (evidence.verified || templateOnly);
  const text = readable
    ? redactSecrets(
        refusal ??
          (paged
            ? `${plan.text}\n\nThis answer touched more than ${MAX_BASIC_SOURCES} records; only the first ${MAX_BASIC_SOURCES} are cited. Narrow the question (a service, a status or a shorter window) for complete citations.`
            : plan.text)
      )
    : 'The source changed or became unavailable. Please ask for a fresh answer.';
  yield* typed(text);
  const citations = evidence.citations(text);
  if (citations.length > 0) yield { type: 'citations', items: citations };
  if (operationCard && readable) yield { type: 'proposal', proposal: operationCard };
  if (readable) for (const card of plan.cards ?? []) yield { type: 'proposal', proposal: card };
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
  incident: ReadableIncident,
  settings: Pick<AiSettingsView, 'squireEnabled'>
): Promise<IncidentBriefing> {
  // The pinned briefing is the panel's view of the same findings, with the incident's one shared AI summary.
  const [pinned, analysis] = await Promise.all([
    getPinnedBriefingForActor(actor, incident.id, undefined, incident, settings).catch(() => null),
    readIncidentAnalysisState(actor, incident.id).catch(() => null),
  ]);
  // The timeline is only the fallback for an incident without the shared summary.
  const events = pinned?.summary
    ? []
    : await prisma.incidentEvent
        .findMany({
          where: { incidentId: incident.id },
          orderBy: { createdAt: 'desc' },
          take: 8,
          select: { type: true, createdAt: true, message: true },
        })
        .catch(() => []);
  return {
    incident,
    analysis: analysis
      ? {
          status: analysis.status,
          message: analysis.message,
          lastSuccessfulAt: analysis.lastSuccessfulAt,
        }
      : { status: 'UNAVAILABLE', message: 'Recommendation freshness could not be verified.' },
    // The shared summary already covers the incident's story; the raw timeline is only the fallback.
    ...(pinned?.summary
      ? { summary: pinned.summary }
      : {
          timeline: events.map(event => ({
            type: event.type ?? 'EVENT',
            at: event.createdAt.toISOString(),
            summary: event.message.slice(0, 240),
          })),
        }),
    similar: (pinned?.similar ?? []).map(s => ({
      id: s.incidentId,
      title: s.title,
      matchPercent: s.matchPercent,
      status: s.status,
    })),
    changes: (pinned?.changes ?? []).map(c => ({
      id: c.changeId,
      summary: c.summary,
      kind: c.kind,
      minutesBeforeOnset: c.leadMinutes,
    })),
    runbooks: (pinned?.runbooks ?? []).map(r => ({
      id: r.runbookId,
      name: r.name,
      succeeded: r.succeeded,
      completedRuns: r.eligible,
    })),
  };
}

/** Messages summarised together: the replay boundary moves in steps of this many (three exchanges). */
const HISTORY_BLOCK = 6;

/**
 * Earlier turns. A saved conversation is the source of truth when history is on (the person's own, read
 * on the server); otherwise the browser's copy is used, already trimmed by the request schema.
 */
interface PriorTurns {
  messages: AiMessage[];
  omitted: boolean;
  /** The digest of turns before the replay window (also first in `messages`). */
  summary?: AiMessage;
}

async function priorTurns(
  actor: AuthorizationActor,
  request: SquireRequest,
  saved: ConversationDetail | null,
  incidentId: string | null
): Promise<PriorTurns> {
  if (saved) {
    // The summarised/verbatim boundary moves in fixed blocks, so the summary and the replayed turns stay
    // byte-identical (and cached) for several turns instead of shifting by one on every turn.
    const cut = Math.max(
      0,
      Math.ceil((saved.messages.length - SQUIRE_LIMITS.historyMax) / HISTORY_BLOCK) * HISTORY_BLOCK
    );
    const turns = saved.messages.slice(cut);
    // A completed answer is replayed whether or not its sources were verified (labelled below), so a follow-up
    // such as "yes, do it" keeps its context; interrupted and access-changed ones are not (`replayable`).
    const isReplayable = (message: ConversationDetail['messages'][number]) =>
      message.replayable !== false &&
      (message.role === 'user' || message.envelope?.completion === 'COMPLETED');
    // The conversation follows the person across pages: a question asked elsewhere says where.
    const here = incidentId
      ? `incident:${incidentId}`
      : request.pageContext
        ? `${request.pageContext.kind}:${request.pageContext.id}`
        : null;
    const askedOn = (message: ConversationDetail['messages'][number]) => {
      const context =
        message.envelope?.context ??
        (saved.incidentId ? { kind: 'incident' as const, id: saved.incidentId } : null);
      if (context?.kind === 'general') return here ? '[Asked as a general question] ' : '';
      if (!context || `${context.kind}:${context.id}` === here) return '';
      return context.kind === 'incident'
        ? `[Asked while viewing incident /incidents/${context.id}] `
        : `[Asked while viewing a ${context.kind.replace('_', ' ')} page] `;
    };
    // Turns before the replay window are summarised (pinned after the system prompt), not dropped. The
    // summary is the deterministic digest: a model summary here would add a SUMMARIZE call, a per-user
    // rate-limit slot, budget spend and a serial round trip before the answer to every turn of a long
    // conversation, with nothing to switch it off.
    const summary = await summarizeOlderTurns(saved.messages.slice(0, cut).filter(isReplayable), {
      actorId: actor.id,
      incidentId: incidentId ?? undefined,
    }).catch(() => null);
    return {
      ...(summary ? { summary } : {}),
      messages: [
        ...(summary ? [summary] : []),
        ...turns.map(message => ({
          role: message.role,
          content: !isReplayable(message)
            ? // A stand-in keeps the turns in order without the text (interrupted, or no longer readable).
              `[Earlier ${message.role === 'user' ? 'question' : 'answer'} not included: it was interrupted or its sources are no longer readable.]`
            : message.role === 'assistant'
              ? `${
                  message.envelope?.verified
                    ? `[Saved answer recorded ${message.createdAt.toISOString()}; verify current facts with tools.]`
                    : earlierAnswerLabel(message.createdAt.toISOString(), false)
                }\n${
                  // Every answer the same way, whatever its position, so the replayed prefix is append-only.
                  message.content.slice(0, SQUIRE_LIMITS.historyTurnMax)
                }`
              : `${askedOn(message)}${message.content}`.slice(0, SQUIRE_LIMITS.historyTurnMax),
          dataClass: isReplayable(message) ? message.dataClass : ('INTERNAL' as const),
        })),
      ],
      omitted: !turns.every(isReplayable),
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
    // Every completed answer gets a proof so the browser can replay it; an unverified one says so.
    mintContextProof({
      actor,
      incidentId: request.incidentId,
      role: 'assistant',
      text: answer,
      dataClass,
      sources,
      verified,
    }).catch(() => undefined),
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
