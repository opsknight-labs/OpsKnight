import 'server-only';
import {
  APICallError,
  EmptyResponseBodyError,
  InvalidResponseDataError,
  Output,
  RetryError,
  embedMany,
  generateText,
  jsonSchema,
  streamText,
  tool,
  zodSchema,
  type EmbeddingModel,
  type LanguageModel,
  type ModelMessage,
  type StopCondition,
  type ToolSet,
} from 'ai';
import { logAudit } from '@/lib/audit';
import { logger } from '@/lib/logger';
import { failSpan, startSpan, withSpan } from '../telemetry';
import { safeOutboundFetch } from '@/lib/network-security';
import { assertNotMetadataEndpoint } from './egress';
import {
  admitAiRequest,
  CACHE_READ_BUDGET_WEIGHT,
  estimateTokens,
  recordAiUsage,
  reserveAiTokens,
  type AiReservation,
} from './budget';
import { ProviderBreakers } from './breaker';
import { attributeTeam, priceForModel } from './cost';
import { costMicrosFor, providerCacheSavedMicros } from './pricing';
import { callSiteRefusal } from './call-site';
import { PostgresBreakerStore } from './breaker-store';
import { embeddingSpaceIdentity } from '../semantic/identity';
import { AI_SETTINGS_BOUNDS } from './contract';
import { selectProviderChain } from './policy';
import { applyCapabilityRoute, applyDefaultTiers, CAPABILITY_TIERS } from './routing';
import { redactSecrets, sanitizeUntrusted, UNTRUSTED_DATA_PREAMBLE } from './redact';
import {
  highestDataClass,
  compactToolSchema,
  registerEmbeddingResolver,
  registerLanguageModelResolver,
  type AiCapability,
  type AiDataClass,
  type AiStructuredRequest,
  type AiStructuredResult,
  type EmbeddingPort,
  type AiGenerateRequest,
  type AiGenerateResult,
  type AiStreamEvent,
  type AiToolCall,
  type AiToolDefinition,
  type AiUsage,
  type LanguageModelPort,
} from './port';
import {
  getAiSettings,
  loadProvidersForGateway,
  type AiSettingsView,
  type GatewayProvider,
} from './settings';

export type AiGatewayErrorCode =
  | 'RATE_LIMITED'
  | 'BUDGET_EXHAUSTED'
  | 'NO_PROVIDER'
  | 'ALL_PROVIDERS_FAILED'
  | 'ABORTED'
  | 'OUTPUT_INVALID'
  /** Budget or rate-limit bookkeeping failed (database, lock): not a refusal, so retrying later may work. */
  | 'UNAVAILABLE'
  /** The request carried no call-site tag, or was made while a list view or badge was rendering. */
  | 'CALL_SITE_REFUSED';

export class AiGatewayError extends Error {
  constructor(
    readonly code: AiGatewayErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'AiGatewayError';
  }
}

const DEFAULT_MAX_STEPS = 4;
const MAX_STEPS_CEILING = 6;
const TOOL_OUTPUT_LIMIT = 8_000;

export const breakers = new ProviderBreakers();
/** Embedding health is tracked separately: a broken embedding endpoint must not take chat down, or the reverse. */
export const embeddingBreakers = new ProviderBreakers();

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const urlOf = (input: RequestInfo | URL) =>
  typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

/**
 * Every provider request goes through one of two guarded fetches. Public endpoints use the SSRF-safe
 * fetch (HTTPS, public addresses only, no redirects). A private endpoint is reachable only when an
 * administrator consented to it, and then only at the exact origin they approved.
 */
export function guardedFetchFor(
  provider: Pick<GatewayProvider, 'allowPrivateNetwork' | 'baseUrl'>
): FetchFn {
  if (provider.allowPrivateNetwork && provider.baseUrl) {
    const origin = new URL(provider.baseUrl).origin;
    return async (input, init) => {
      const url = new URL(urlOf(input));
      if (url.origin !== origin) throw new Error('Request outside the approved provider origin');
      await assertNotMetadataEndpoint(url);
      return fetch(url, { ...init, redirect: 'error' });
    };
  }
  // Public endpoints must be HTTPS on every request, not only when saved: a credential is attached.
  return (input, init) => {
    if (new URL(urlOf(input)).protocol !== 'https:') {
      return Promise.reject(new Error('HTTPS is required for public AI endpoints'));
    }
    return safeOutboundFetch(urlOf(input), init);
  };
}

type ModelKind = 'chat' | 'embedding';

function missingCredentials(): never {
  throw new Error('Provider credentials are missing or unreadable');
}

const apiKeyOf = (provider: GatewayProvider) =>
  provider.credentials.type === 'apiKey' ? provider.credentials.apiKey : undefined;

/**
 * Builds a chat or embedding model for one provider. Every client gets `common`, which carries the guarded
 * fetch, so every request a provider makes to its API goes through the same egress controls. The one
 * exception is Vertex's OAuth token exchange, which always targets Google's fixed token endpoint.
 */
async function buildProviderModel(provider: GatewayProvider, kind: 'chat'): Promise<LanguageModel>;
async function buildProviderModel(
  provider: GatewayProvider,
  kind: 'embedding'
): Promise<EmbeddingModel>;
async function buildProviderModel(
  provider: GatewayProvider,
  kind: ModelKind
): Promise<LanguageModel | EmbeddingModel> {
  const fetchImpl = guardedFetchFor(provider) as typeof fetch;
  const common = { fetch: fetchImpl };
  const baseURL = provider.baseUrl ?? undefined;
  const embeddingId = provider.embeddingModel ?? '';
  switch (provider.kind) {
    case 'OPENAI': {
      const { createOpenAI } = await import('@ai-sdk/openai');
      const client = createOpenAI({ ...common, apiKey: apiKeyOf(provider), baseURL });
      return kind === 'chat' ? client.chat(provider.model) : client.textEmbeddingModel(embeddingId);
    }
    case 'ANTHROPIC': {
      if (kind === 'embedding') throw new Error('Anthropic does not provide embeddings');
      const { createAnthropic } = await import('@ai-sdk/anthropic');
      return createAnthropic({ ...common, apiKey: apiKeyOf(provider), baseURL })(provider.model);
    }
    case 'GOOGLE': {
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
      const client = createGoogleGenerativeAI({ ...common, apiKey: apiKeyOf(provider), baseURL });
      return kind === 'chat' ? client(provider.model) : client.textEmbeddingModel(embeddingId);
    }
    case 'OPENAI_COMPATIBLE': {
      const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');
      const client = createOpenAICompatible({
        ...common,
        apiKey: apiKeyOf(provider),
        name: 'compatible',
        baseURL: baseURL ?? '',
      });
      return kind === 'chat'
        ? client.chatModel(provider.model)
        : client.textEmbeddingModel(embeddingId);
    }
    case 'AZURE_OPENAI': {
      const { createAzure } = await import('@ai-sdk/azure');
      const client = createAzure({
        ...common,
        apiKey: apiKeyOf(provider),
        ...(baseURL ? { baseURL } : { resourceName: provider.options.azureResourceName }),
        ...(provider.options.azureApiVersion
          ? { apiVersion: provider.options.azureApiVersion }
          : {}),
      });
      // The model field is the deployment name.
      return kind === 'chat' ? client.chat(provider.model) : client.textEmbeddingModel(embeddingId);
    }
    case 'BEDROCK': {
      const { createAmazonBedrock } = await import('@ai-sdk/amazon-bedrock');
      const credentials = provider.credentials;
      const auth =
        credentials.type === 'aws'
          ? { accessKeyId: credentials.accessKeyId, secretAccessKey: credentials.secretAccessKey }
          : credentials.type === 'apiKey'
            ? { apiKey: credentials.apiKey }
            : missingCredentials();
      const client = createAmazonBedrock({
        ...common,
        region: provider.options.awsRegion,
        ...auth,
      });
      return kind === 'chat' ? client(provider.model) : client.textEmbeddingModel(embeddingId);
    }
    case 'VERTEX': {
      const credentials = provider.credentials;
      if (credentials.type !== 'google') missingCredentials();
      const { createVertex } = await import('@ai-sdk/google-vertex/edge');
      const client = createVertex({
        ...common,
        project: provider.options.gcpProject,
        location: provider.options.gcpLocation,
        googleCredentials: {
          clientEmail: credentials.clientEmail,
          privateKey: credentials.privateKey,
          ...(credentials.privateKeyId ? { privateKeyId: credentials.privateKeyId } : {}),
        },
      });
      return kind === 'chat' ? client(provider.model) : client.textEmbeddingModel(embeddingId);
    }
    case 'MISTRAL': {
      const { createMistral } = await import('@ai-sdk/mistral');
      const client = createMistral({ ...common, apiKey: apiKeyOf(provider), baseURL });
      return kind === 'chat' ? client(provider.model) : client.textEmbeddingModel(embeddingId);
    }
    case 'GROQ': {
      if (kind === 'embedding') throw new Error('Groq does not provide embeddings');
      const { createGroq } = await import('@ai-sdk/groq');
      return createGroq({ ...common, apiKey: apiKeyOf(provider), baseURL })(provider.model);
    }
  }
}

const buildModel = (provider: GatewayProvider) => buildProviderModel(provider, 'chat');

/**
 * Every tool result reaches the model inside an untrusted-data envelope: secrets are redacted, text shaped
 * like an instruction to the model is defanged, the whole thing is bounded, and a fixed preamble says what it
 * is. Alerts, notes and payloads are written by systems and people the operator does not control.
 */
export function capOutput(value: unknown): unknown {
  const sanitized = sanitizeUntrusted(value);
  const text = typeof sanitized === 'string' ? sanitized : JSON.stringify(sanitized ?? null);
  const safe = redactSecrets(text);
  const bounded =
    safe.length > TOOL_OUTPUT_LIMIT ? `${safe.slice(0, TOOL_OUTPUT_LIMIT)}… [truncated]` : safe;
  return `${UNTRUSTED_DATA_PREAMBLE}\n${bounded}`;
}

/** One slow lookup (a stuck backend, a heavy query) must not hold the whole answer. */
export const TOOL_DEADLINE_MS = 20_000;
const TOOL_TIMED_OUT =
  'This lookup took too long and was stopped. Answer from what you already have and say this one timed out.';

export class ToolDeadlineError extends Error {
  constructor() {
    super('Tool deadline exceeded');
    this.name = 'ToolDeadlineError';
  }
}

export function withToolDeadline<T>(work: Promise<T>, ms = TOOL_DEADLINE_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ToolDeadlineError()), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Runs one tool call under the deadline with its own signal, aborted when the deadline passes or `parent` (the
 * SDK's per-call signal: request cancelled, step or total timeout) aborts. The tool may stop on it; a result
 * that still arrives later finds the signal aborted and is discarded (it is settled), never recorded.
 */
export function runWithDeadline<T>(
  run: (signal: AbortSignal) => Promise<T>,
  parent?: AbortSignal,
  ms = TOOL_DEADLINE_MS
): Promise<T> {
  const controller = new AbortController();
  const signal = parent ? AbortSignal.any([parent, controller.signal]) : controller.signal;
  return withToolDeadline(run(signal), ms).catch(error => {
    controller.abort(error);
    throw error;
  });
}

function toToolSet(definitions: AiToolDefinition[] | undefined): ToolSet | undefined {
  if (!definitions || definitions.length === 0) return undefined;
  const set: ToolSet = {};
  for (const definition of definitions) {
    const execute = definition.kind === 'READ' ? definition.execute : undefined;
    const validate = definition.validate;
    const inputSchema = jsonSchema<unknown>(
      compactToolSchema(definition.inputSchema) as Parameters<typeof jsonSchema>[0]
    );
    set[definition.name] = execute
      ? tool<unknown, unknown>({
          description: definition.description,
          inputSchema,
          execute: async (input: unknown, { abortSignal }) => {
            try {
              return capOutput(
                await runWithDeadline(signal => execute(input, { signal }), abortSignal)
              );
            } catch (error) {
              if (error instanceof ToolDeadlineError) return TOOL_TIMED_OUT;
              // The model sees a neutral failure; details stay with the tool's own logging.
              return 'The tool failed or you are not permitted to use it.';
            }
          },
        })
      : // A proposal is acknowledged so the model can carry on and explain it, but nothing is executed: the
        // caller receives the call and decides whether to show it to a person for confirmation.
        tool<unknown, string>({
          description: definition.description,
          inputSchema,
          execute: async (input: unknown) =>
            validate && !validate(input) ? PROPOSAL_INVALID : PROPOSAL_ACKNOWLEDGEMENT,
        });
  }
  return set;
}

/** The caller still checks the card (permissions, current state), so the model is not told it was shown. */
export const PROPOSAL_ACKNOWLEDGEMENT =
  'Sent as a suggestion card: it is shown to the user if it is still valid, and happens only if they confirm it. Do not say it has been done or shown.';
export const PROPOSAL_INVALID =
  'That suggestion was not valid (check the required fields and ids) and nothing was shown. Correct it, or tell the user what you would suggest instead.';

/** A proposal call the caller may present: well formed (the SDK parsed it) and accepted by its validator. */
function validProposal(
  call: { toolName: string; input: unknown; invalid?: boolean },
  proposals: ReadonlyMap<string, AiToolDefinition>
): boolean {
  const definition = proposals.get(call.toolName);
  if (!definition || call.invalid) return false;
  return !definition.validate || definition.validate(call.input);
}

const proposalTools = (definitions: AiToolDefinition[] | undefined) =>
  new Map((definitions ?? []).filter(d => d.kind === 'PROPOSE_WRITE').map(d => [d.name, d]));

/**
 * The system prompt is the stable prefix of every request (rules, guidance, incident context), so providers
 * that cache prompts explicitly are told to cache it; OpenAI-style providers cache long prefixes on their own.
 */
const CACHE_HINTS: Partial<
  Record<GatewayProvider['kind'], Record<string, Record<string, unknown>>>
> = {
  ANTHROPIC: { anthropic: { cacheControl: { type: 'ephemeral' } } },
  BEDROCK: { bedrock: { cachePoint: { type: 'default' } } },
};

const toMessages = (request: AiGenerateRequest, kind?: GatewayProvider['kind']): ModelMessage[] =>
  request.messages.map(message => {
    const content = redactSecrets(message.content);
    // eslint-disable-next-line security/detect-object-injection -- kind is a member of the closed provider-kind union
    const hint = message.role === 'system' && kind ? CACHE_HINTS[kind] : undefined;
    return (
      hint
        ? { role: message.role, content, providerOptions: hint }
        : { role: message.role, content }
    ) as ModelMessage;
  });

/**
 * Rolling cache breakpoint: besides the system prompt's marker, the newest message of every step is marked, so
 * the next step (and the next turn) reads the whole conversation so far from cache. At most two markers are
 * live per request, within Anthropic's four.
 */
export function withRollingCacheBreakpoint(
  messages: ModelMessage[],
  kind: GatewayProvider['kind']
): ModelMessage[] {
  // eslint-disable-next-line security/detect-object-injection -- kind is a member of the closed provider-kind union
  const hint = CACHE_HINTS[kind];
  const last = messages.at(-1);
  if (!hint || !last || last.role === 'system') return messages;
  return [
    ...messages.slice(0, -1),
    { ...last, providerOptions: { ...last.providerOptions, ...hint } } as ModelMessage,
  ];
}

const clampSteps = (steps: number | undefined) =>
  Math.max(1, Math.min(MAX_STEPS_CEILING, steps ?? DEFAULT_MAX_STEPS));

function proposedCalls(
  steps: ReadonlyArray<{
    toolCalls: ReadonlyArray<{ toolName: string; input: unknown; invalid?: boolean }>;
  }>,
  definitions: AiToolDefinition[] | undefined
): AiToolCall[] {
  const proposals = proposalTools(definitions);
  return steps.flatMap(step =>
    step.toolCalls
      .filter(call => validProposal(call, proposals))
      .map(call => ({ name: call.toolName, input: call.input }))
  );
}

/**
 * Whether a failed call says something about the provider's health. Server errors, rate limits, rejected
 * credentials and network failures do. A request the provider refused as malformed or naming a missing model
 * (400/404/413/422) is this route's configuration, not the provider being down, so it never trips the breaker
 * for every other capability. Our own step/idle timer counts only while nothing had come back yet: once tools
 * ran or text streamed, the time went on our side (tools, a long answer).
 */
export function isProviderFault(error: unknown, progressed: boolean): boolean {
  const cause = RetryError.isInstance(error) ? error.lastError : error;
  if (APICallError.isInstance(cause)) {
    const status = cause.statusCode;
    return status === undefined || ![400, 404, 413, 422].includes(status);
  }
  if (InvalidResponseDataError.isInstance(cause) || EmptyResponseBodyError.isInstance(cause))
    return true;
  const name = (cause as { name?: unknown } | null)?.name;
  return !progressed && (name === 'TimeoutError' || name === 'AbortError');
}

/**
 * Prompt tokens a further step adds to the hold. A provider that caches reads the previous step's whole prompt
 * from cache, which the budget counts at CACHE_READ_BUDGET_WEIGHT; only the rest is charged in full.
 */
export function stepInputEstimate(sent: number, previousPrompt: number, caches: boolean): number {
  const cached = caches ? Math.min(previousPrompt, sent) : 0;
  return Math.max(0, sent - Math.round(cached * (1 - CACHE_READ_BUDGET_WEIGHT)));
}

/** The whole-call cap: every step may use its model time plus a tool deadline. */
function timeouts(requestTimeoutMs: number, maxSteps: number | undefined, streaming: boolean) {
  const stepMs = requestTimeoutMs + TOOL_DEADLINE_MS;
  return {
    totalMs: clampSteps(maxSteps) * stepMs,
    stepMs,
    // Idle between stream parts; a running tool sends nothing until its result, so it gets its deadline.
    ...(streaming ? { chunkMs: Math.max(requestTimeoutMs, TOOL_DEADLINE_MS + 5_000) } : {}),
  };
}

const addUsage = (a: AiUsage, b: AiUsage): AiUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  ...(a.cacheReadTokens || b.cacheReadTokens
    ? { cacheReadTokens: (a.cacheReadTokens ?? 0) + (b.cacheReadTokens ?? 0) }
    : {}),
  ...(a.cacheWriteTokens || b.cacheWriteTokens
    ? { cacheWriteTokens: (a.cacheWriteTokens ?? 0) + (b.cacheWriteTokens ?? 0) }
    : {}),
});

/** Per-attempt loop state shared by the stop condition, the step preparation and the step callback. */
interface LoopState {
  /** Real usage of the steps that finished, for settling a call that fails or is cancelled later. */
  used: AiUsage | null;
  /** Prompt tokens of the last finished step. */
  lastPrompt: number;
  /** A provider that reported cache reads or writes. */
  caching: boolean;
  /** A tool ran: the turn has read (and recorded) evidence, so another provider must not start over. */
  toolsRan: boolean;
  /** The budget refused another tool step: one last step answers without tools. */
  budgetLimited: boolean;
}

const newLoop = (): LoopState => ({
  used: null,
  lastPrompt: 0,
  caching: false,
  toolsRan: false,
  budgetLimited: false,
});

function recordStep(
  loop: LoopState,
  step: { usage: Parameters<typeof usageOf>[0]; toolResults?: readonly unknown[] }
) {
  const usage = usageOf(step.usage);
  loop.used = loop.used ? addUsage(loop.used, usage) : usage;
  loop.lastPrompt = usage.inputTokens;
  if (usage.cacheReadTokens || usage.cacheWriteTokens) loop.caching = true;
  if (step.toolResults?.length) loop.toolsRan = true;
}

interface GatewayContextData {
  settings: AiSettingsView;
  chain: GatewayProvider[];
}

/** Token counts as the SDK reports them; `inputTokens` is the total and includes both cache figures. */
export function usageOf(usage: {
  inputTokens?: number;
  outputTokens?: number;
  inputTokenDetails?: { cacheReadTokens?: number; cacheWriteTokens?: number };
}): AiUsage {
  const read = usage.inputTokenDetails?.cacheReadTokens ?? 0;
  const write = usage.inputTokenDetails?.cacheWriteTokens ?? 0;
  return {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    ...(read > 0 ? { cacheReadTokens: read } : {}),
    ...(write > 0 ? { cacheWriteTokens: write } : {}),
  };
}

/**
 * Deterministic-first gate: every model call says where it comes from, and none may start while a list view
 * or badge is rendering. Checked before admission so a refused call costs no rate-limit slot and no tokens.
 */
/** Budget or rate-limit bookkeeping failed: a temporary outage, never reported as a spent budget. */
function unavailable(stage: 'admission' | 'reservation', error: unknown): never {
  if (error instanceof AiGatewayError) throw error;
  logger.warn('[AI] Budget bookkeeping failed', {
    stage,
    error: error instanceof Error ? error.name : 'error',
  });
  throw new AiGatewayError('UNAVAILABLE', 'AI is temporarily unavailable');
}

export function assertCallSite(request: AiGenerateRequest): void {
  const refusal = callSiteRefusal(request.context);
  if (refusal) throw new AiGatewayError('CALL_SITE_REFUSED', refusal);
}

/** Prompt size estimate for a call that ended before the provider reported usage. */
function estimatedInput(request: AiGenerateRequest): number {
  return estimateTokens(request.messages.map(message => message.content).join('\n'));
}

/**
 * Usage for an attempt that ended before the provider reported its total: the finished steps' real usage plus
 * the text streamed since, or the prompt estimate when no step finished.
 */
function unsettledUsage(request: AiGenerateRequest, loop: LoopState, pendingText = ''): AiUsage {
  const pending = estimateTokens(pendingText);
  return loop.used
    ? { ...loop.used, outputTokens: loop.used.outputTokens + pending }
    : { inputTokens: estimatedInput(request), outputTokens: pending };
}

class GatewayPort implements LanguageModelPort {
  constructor(private readonly data: GatewayContextData) {}

  get model(): string | undefined {
    return this.data.chain[0]?.model;
  }

  /** One team attribution per request, shared by every provider attempt and its settlement. */
  private readonly teams = new WeakMap<AiGenerateRequest, Promise<string | null>>();

  private teamFor(request: AiGenerateRequest): Promise<string | null> {
    let team = this.teams.get(request);
    if (!team) {
      team = attributeTeam(request.context.actorId, request.context.incidentId);
      this.teams.set(request, team);
    }
    return team;
  }

  private async admit(request: AiGenerateRequest) {
    assertCallSite(request);
    const decision = await admitAiRequest(
      request.context.actorId,
      this.data.settings,
      new Date(),
      request.context.callSite
    ).catch(error => unavailable('admission', error));
    if (!decision.allowed) {
      throw new AiGatewayError(
        decision.reason,
        decision.reason === 'RATE_LIMITED' ? 'Too many requests' : 'Daily AI budget reached'
      );
    }
    if (decision.degraded) this.degraded.add(request);
  }

  /** Requests admitted past the degradation point: small model, shorter answers. */
  private readonly degraded = new WeakSet<AiGenerateRequest>();

  /** Answer-length ceiling for this request; halved while the day's spend is past the degradation point. */
  private outputLimit(request: AiGenerateRequest, ceiling: number): number {
    const limit = Math.min(request.maxOutputTokens ?? this.data.settings.maxOutputTokens, ceiling);
    return this.degraded.has(request)
      ? Math.max(AI_SETTINGS_BOUNDS.maxOutputTokens.min, Math.floor(limit / 2))
      : limit;
  }

  /** Marks an answer written under degradation, so the result cache does not keep it as the normal answer. */
  private mark<R extends object>(request: AiGenerateRequest, result: R): R {
    return this.degraded.has(request) ? { ...result, degraded: true } : result;
  }

  /**
   * Holds one step's worth of tokens: the prompt so far, the tool catalogue and a full answer. A multi-step
   * call tops the same hold up before each further step (`topUp`) instead of holding every step up front.
   */
  private async hold(
    request: AiGenerateRequest,
    provider: GatewayProvider,
    input: number,
    structured: boolean,
    extend?: AiReservation
  ): Promise<AiReservation | null> {
    const output = structured
      ? this.outputLimit(request, AI_SETTINGS_BOUNDS.maxOutputTokens.max)
      : this.outputLimit(request, this.data.settings.maxOutputTokens);
    const inputEstimate =
      input +
      estimateTokens(
        JSON.stringify(
          request.tools?.map(tool => ({ name: tool.name, description: tool.description })) ?? []
        )
      );
    // Cost governance: charge the hold to a team and capability, with a dollar estimate when priced.
    const [teamId, price] = await Promise.all([
      this.teamFor(request),
      priceForModel(provider.kind, provider.model),
    ]);
    return reserveAiTokens(
      request.context.actorId,
      this.data.settings,
      inputEstimate + output,
      this.data.settings.requestTimeoutMs * (this.data.chain.length + 1) + 60_000,
      new Date(),
      {
        teamId,
        capability: request.context.capability,
        callSite: request.context.callSite,
        costMicros: costMicrosFor({ inputTokens: inputEstimate, outputTokens: output }, price),
      },
      extend
    );
  }

  /**
   * The first hold. Only a refusal is "Daily AI budget reached"; a database or lock failure is reported as a
   * temporary outage, so a person is never told the budget is spent when it is not.
   */
  private async reserve(request: AiGenerateRequest, provider: GatewayProvider, structured = false) {
    let reservation: AiReservation | null;
    try {
      reservation = await this.hold(request, provider, estimatedInput(request), structured);
    } catch (error) {
      breakers.release(provider.id);
      return unavailable('reservation', error);
    }
    if (!reservation) {
      breakers.release(provider.id);
      throw new AiGatewayError('BUDGET_EXHAUSTED', 'Daily AI budget reached');
    }
    return reservation;
  }

  /** Per-step options for a tool loop: the rolling cache breakpoint. */
  private stepper(provider: GatewayProvider, request: AiGenerateRequest, loop: LoopState) {
    const last = clampSteps(request.maxSteps) - 1;
    return ({ messages, stepNumber }: { messages: ModelMessage[]; stepNumber: number }) => ({
      messages: withRollingCacheBreakpoint(messages, provider.kind),
      // The last allowed step (or the one the budget leaves) must answer from what was read: a tool loop never
      // ends without a word.
      ...((last > 0 && stepNumber >= last) || loop.budgetLimited
        ? { toolChoice: 'none' as const }
        : {}),
    });
  }

  /**
   * When a tool loop stops: at the step cap, or after the answer step that follows a refused top-up. The top-up
   * runs only when the loop would otherwise continue. When the budget refuses it, one last step runs without
   * tools so the person gets an answer from what was already read (it overruns the hold by at most that step,
   * and is settled at its real usage), and the result says the answer was cut short.
   */
  private stopper(
    request: AiGenerateRequest,
    provider: GatewayProvider,
    reservation: AiReservation,
    loop: LoopState
  ): StopCondition<ToolSet> {
    const maxSteps = clampSteps(request.maxSteps);
    return async ({ steps }) => {
      if (steps.length >= maxSteps || loop.budgetLimited) return true;
      const sent = JSON.stringify([request.messages, steps.at(-1)?.response.messages ?? []]);
      const funded = await this.hold(
        request,
        provider,
        stepInputEstimate(
          estimateTokens(sent),
          loop.lastPrompt,
          loop.caching || Boolean(CACHE_HINTS[provider.kind])
        ),
        false,
        reservation
      ).catch(error => {
        logger.warn('[AI] Could not top up the token hold', {
          error: error instanceof Error ? error.name : 'error',
        });
        return null;
      });
      if (!funded) loop.budgetLimited = true;
      return false;
    };
  }

  /**
   * The caller's signal only: step, idle and total time limits are the SDK's `timeout` (see `timeouts`), so a
   * multi-step loop is not cut off by one request-sized timer.
   */
  private signalFor(request: AiGenerateRequest): AbortSignal | undefined {
    return request.context.signal;
  }

  private candidates(request: AiGenerateRequest): GatewayProvider[] {
    const required = highestDataClass([
      request.context.dataClass,
      ...request.messages.map(message => message.dataClass),
      ...(request.tools ?? []).map(tool => tool.dataClass),
    ]);
    if (required !== request.context.dataClass)
      throw new AiGatewayError(
        'NO_PROVIDER',
        'Request classification does not cover its conversation context'
      );
    // Re-checking the policy must not undo a capability route: keep the resolved chain's order.
    const order = new Map(this.data.chain.map((provider, index) => [provider, index]));
    const allowed = selectProviderChain(this.data.chain, required, {
      allowExternalFallback: this.data.settings.allowExternalFallback,
      allowedRegions: this.data.settings.allowedDataRegions,
    }).sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    const open = allowed.filter(provider => breakers.available(provider.id));
    if (open.length === 0)
      throw new AiGatewayError('NO_PROVIDER', 'No AI provider is currently available');
    return this.degraded.has(request)
      ? applyDefaultTiers(open, request.context.capability, 'small')
      : open;
  }

  private async finish(
    request: AiGenerateRequest,
    result: Pick<AiGenerateResult, 'usage' | 'served'>,
    extra: Record<string, string | number | boolean> = {},
    reservation?: AiReservation
  ): Promise<void> {
    await this.attribution(request, result)
      .then(attribution =>
        recordAiUsage(result.usage, new Date(), request.context.actorId, reservation, attribution)
      )
      .catch(error =>
        logger.warn('[AI] Could not record usage', {
          error: error instanceof Error ? error.message : String(error),
        })
      );
    await logAudit({
      action: 'intelligence.ai.interaction',
      entityType: 'SYSTEM_CONFIG',
      entityId: 'ai',
      actorId: request.context.actorId,
      source: 'UI',
      // Metadata only: prompts and answers are never stored.
      details: {
        capability: request.context.capability,
        callSite: request.context.callSite,
        providerId: result.served.providerId,
        model: result.served.model,
        fallbackDepth: result.served.fallbackDepth,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        ...(request.context.prompt
          ? {
              promptId: request.context.prompt.id,
              promptVersion: request.context.prompt.version,
              promptHash: request.context.prompt.hash,
              guidanceRevision: request.context.prompt.guidanceRevision,
            }
          : {}),
        ...extra,
      },
    }).catch(() => undefined);
  }

  private async attribution(
    request: AiGenerateRequest,
    result: Pick<AiGenerateResult, 'usage' | 'served'>
  ) {
    const provider = this.data.chain.find(candidate => candidate.id === result.served.providerId);
    if (!provider) return undefined;
    const [teamId, price] = await Promise.all([
      this.teamFor(request).catch(() => null),
      priceForModel(provider.kind, result.served.model),
    ]);
    return {
      providerKind: provider.kind,
      model: result.served.model,
      capability: request.context.capability,
      teamId,
      costMicros: costMicrosFor(result.usage, price),
      cacheSavedMicros: providerCacheSavedMicros(result.usage, price),
    };
  }

  async generateStructured<T>(request: AiStructuredRequest<T>): Promise<AiStructuredResult<T>> {
    await this.admit(request);
    let attempts = 0;
    let invalidOutputs = 0;
    await breakers.sync(this.data.chain.map(candidate => candidate.id));
    for (const [depth, provider] of this.candidates(request).entries()) {
      if (!breakers.canAttempt(provider.id)) continue;
      const reservation = await this.reserve(request, provider, true);
      let accounted = false;
      attempts += 1;
      try {
        const result = await withSpan(
          'intelligence.ai.generate_structured',
          {
            'ai.capability': request.context.capability,
            'ai.provider.kind': provider.kind,
            'ai.fallback.depth': depth,
          },
          async span => {
            const generated = await generateText({
              model: await buildModel(provider),
              messages: toMessages(request, provider.kind),
              output: Output.object({
                schema: zodSchema(request.schema as Parameters<typeof zodSchema>[0]),
                name: request.schemaName,
              }),
              // A structured document (a postmortem draft) is not a chat answer: it may ask for more than the
              // answer-length setting, up to the hard ceiling, so it is never cut off and rejected as invalid.
              maxOutputTokens: this.outputLimit(
                request,
                Math.max(this.data.settings.maxOutputTokens, AI_SETTINGS_BOUNDS.maxOutputTokens.max)
              ),
              abortSignal: this.signalFor(request),
              // One step, no tools: the request timeout is the whole call.
              timeout: this.data.settings.requestTimeoutMs,
              maxRetries: 1,
            });
            span.setAttribute('ai.tokens.input', generated.totalUsage.inputTokens ?? 0);
            span.setAttribute('ai.tokens.output', generated.totalUsage.outputTokens ?? 0);
            return generated;
          }
        );
        const usage = usageOf(result.totalUsage);
        const served = { providerId: provider.id, model: provider.model, fallbackDepth: depth };
        // Validated again here, independently of the SDK, so nothing unchecked ever reaches a caller.
        let candidate: unknown;
        try {
          candidate = result.output;
        } catch {
          candidate = undefined;
        }
        const checked = request.schema.safeParse(candidate);
        breakers.recordSuccess(provider.id);
        if (!checked.success) {
          invalidOutputs += 1;
          accounted = true;
          await this.finish(request, { usage, served }, { outputValid: false }, reservation);
          continue;
        }
        accounted = true;
        await this.finish(request, { usage, served }, { outputValid: true }, reservation);
        return this.mark(request, {
          object: checked.data,
          usage,
          served,
          finishReason: result.finishReason,
        });
      } catch (error) {
        if (request.context.signal?.aborted) {
          breakers.release(provider.id);
          throw new AiGatewayError('ABORTED', 'Request cancelled');
        }
        // A model that could not produce schema-shaped output is not a broken provider.
        if (
          error instanceof Error &&
          /NoObjectGenerated|NoOutputGenerated|TypeValidation|JSONParse/.test(error.name)
        ) {
          breakers.recordSuccess(provider.id);
          invalidOutputs += 1;
          continue;
        }
        if (isProviderFault(error, false)) breakers.recordFailure(provider.id);
        else breakers.release(provider.id);
        logger.warn('[AI] Provider call failed', {
          providerId: provider.id,
          error: error instanceof Error ? error.name : 'error',
        });
      } finally {
        if (!accounted)
          await this.finish(
            request,
            {
              usage: { inputTokens: estimatedInput(request), outputTokens: 0 },
              served: { providerId: provider.id, model: provider.model, fallbackDepth: depth },
            },
            { usageEstimated: true },
            reservation
          );
      }
    }
    if (invalidOutputs > 0)
      throw new AiGatewayError(
        'OUTPUT_INVALID',
        'The AI response did not match the expected format'
      );
    throw new AiGatewayError('ALL_PROVIDERS_FAILED', `All ${attempts} AI provider attempts failed`);
  }

  async generate(request: AiGenerateRequest): Promise<AiGenerateResult> {
    await this.admit(request);
    let attempts = 0;
    await breakers.sync(this.data.chain.map(candidate => candidate.id));
    for (const [depth, provider] of this.candidates(request).entries()) {
      if (!breakers.canAttempt(provider.id)) continue;
      const reservation = await this.reserve(request, provider);
      let accounted = false;
      const loop = newLoop();
      attempts += 1;
      try {
        const result = await withSpan(
          'intelligence.ai.generate',
          {
            'ai.capability': request.context.capability,
            'ai.provider.kind': provider.kind,
            'ai.fallback.depth': depth,
          },
          async span => {
            const generated = await generateText({
              model: await buildModel(provider),
              messages: toMessages(request, provider.kind),
              tools: toToolSet(request.tools),
              stopWhen: this.stopper(request, provider, reservation, loop),
              prepareStep: this.stepper(provider, request, loop),
              onStepFinish: step => recordStep(loop, step),
              maxOutputTokens: this.outputLimit(request, this.data.settings.maxOutputTokens),
              abortSignal: this.signalFor(request),
              timeout: timeouts(this.data.settings.requestTimeoutMs, request.maxSteps, false),
              maxRetries: 1,
            });
            span.setAttribute('ai.tokens.input', generated.totalUsage.inputTokens ?? 0);
            span.setAttribute('ai.tokens.output', generated.totalUsage.outputTokens ?? 0);
            return generated;
          }
        );
        breakers.recordSuccess(provider.id);
        const served: AiGenerateResult = {
          text: result.text,
          toolCalls: proposedCalls(result.steps, request.tools),
          usage: usageOf(result.totalUsage),
          served: { providerId: provider.id, model: provider.model, fallbackDepth: depth },
          finishReason: result.finishReason,
          ...(loop.budgetLimited ? { budgetLimited: true } : {}),
        };
        accounted = true;
        await this.finish(request, served, {}, reservation);
        return this.mark(request, served);
      } catch (error) {
        if (request.context.signal?.aborted) {
          breakers.release(provider.id);
          throw new AiGatewayError('ABORTED', 'Request cancelled');
        }
        if (isProviderFault(error, loop.toolsRan)) breakers.recordFailure(provider.id);
        else breakers.release(provider.id);
        logger.warn('[AI] Provider call failed', {
          providerId: provider.id,
          error: error instanceof Error ? error.name : 'error',
        });
        // Tools already ran (and recorded evidence): another provider would read everything again.
        if (loop.toolsRan) break;
      } finally {
        if (!accounted)
          await this.finish(
            request,
            {
              usage: unsettledUsage(request, loop),
              served: { providerId: provider.id, model: provider.model, fallbackDepth: depth },
            },
            { usageEstimated: true },
            reservation
          );
      }
    }
    throw new AiGatewayError('ALL_PROVIDERS_FAILED', `All ${attempts} AI provider attempts failed`);
  }

  async *stream(request: AiGenerateRequest): AsyncIterable<AiStreamEvent> {
    try {
      await this.admit(request);
    } catch (error) {
      if (error instanceof AiGatewayError) {
        yield {
          type: 'error',
          message: error.message,
          retryable: error.code === 'RATE_LIMITED' || error.code === 'UNAVAILABLE',
        };
        return;
      }
      throw error;
    }
    let candidates: GatewayProvider[];
    try {
      await breakers.sync(this.data.chain.map(candidate => candidate.id));
      candidates = this.candidates(request);
    } catch (error) {
      yield {
        type: 'error',
        message: error instanceof Error ? error.message : 'AI unavailable',
        retryable: true,
      };
      return;
    }

    for (const [depth, provider] of candidates.entries()) {
      if (!breakers.canAttempt(provider.id)) continue;
      let reservation: AiReservation;
      try {
        reservation = await this.reserve(request, provider);
      } catch (error) {
        const refused = error instanceof AiGatewayError && error.code === 'BUDGET_EXHAUSTED';
        yield refused
          ? { type: 'error', message: 'Daily AI budget reached', retryable: false }
          : { type: 'error', message: 'AI is temporarily unavailable', retryable: true };
        return;
      }
      let emitted = false;
      let text = '';
      // Text of the step in progress: finished steps are settled from their real usage.
      let pendingText = '';
      const loop = newLoop();
      // Set once this attempt's usage is accounted for (finished, or failed on the provider's side).
      let settled = false;
      const span = startSpan('intelligence.ai.stream', {
        'ai.capability': request.context.capability,
        'ai.provider.kind': provider.kind,
        'ai.fallback.depth': depth,
      });
      try {
        const run = streamText({
          // The SDK default logs the complete provider error, including request bodies. Our stream
          // handler below records bounded error categories and preserves fallback/cancellation instead.
          onError: () => undefined,
          model: await buildModel(provider),
          messages: toMessages(request, provider.kind),
          tools: toToolSet(request.tools),
          stopWhen: this.stopper(request, provider, reservation, loop),
          prepareStep: this.stepper(provider, request, loop),
          onStepFinish: step => {
            recordStep(loop, step);
            pendingText = '';
          },
          maxOutputTokens: this.outputLimit(request, this.data.settings.maxOutputTokens),
          abortSignal: this.signalFor(request),
          timeout: timeouts(this.data.settings.requestTimeoutMs, request.maxSteps, true),
          maxRetries: 0,
        });
        const proposals = proposalTools(request.tools);
        for await (const part of run.fullStream) {
          if (part.type === 'text-delta') {
            emitted = true;
            text += part.text;
            pendingText += part.text;
            yield { type: 'text-delta', delta: part.text };
          } else if (part.type === 'tool-call') {
            // A malformed or rejected proposal is refused to the model (see toToolSet), never shown.
            if (proposals.has(part.toolName)) {
              if (!validProposal(part, proposals)) continue;
              // Something has been shown once a proposal is out, so a later failure must not switch provider.
              emitted = true;
              yield { type: 'tool-call', call: { name: part.toolName, input: part.input } };
            } else if (!part.invalid) {
              loop.toolsRan = true;
              yield { type: 'tool-start', name: part.toolName };
            }
          } else if (part.type === 'error') {
            throw part.error instanceof Error ? part.error : new Error('stream error');
          } else if (part.type === 'abort') {
            // A step, idle or total timeout ends the stream with an abort part rather than an error.
            throw new DOMException('AI request timed out', 'TimeoutError');
          }
        }
        breakers.recordSuccess(provider.id);
        const steps = await run.steps;
        const totalUsage = await run.totalUsage;
        const result: AiGenerateResult = {
          text,
          toolCalls: proposedCalls(steps, request.tools),
          usage: usageOf(totalUsage),
          served: { providerId: provider.id, model: provider.model, fallbackDepth: depth },
          ...(loop.budgetLimited ? { budgetLimited: true } : {}),
        };
        span.setAttribute('ai.tokens.input', result.usage.inputTokens);
        span.setAttribute('ai.tokens.output', result.usage.outputTokens);
        settled = true;
        await this.finish(request, result, {}, reservation);
        yield { type: 'finish', result: this.mark(request, result) };
        return;
      } catch (error) {
        failSpan(span, error);
        if (request.context.signal?.aborted) {
          yield { type: 'error', message: 'Request cancelled', retryable: false };
          return;
        }
        // Our own timer after tools ran or text streamed says nothing about the provider: release the probe.
        if (isProviderFault(error, emitted || loop.toolsRan)) breakers.recordFailure(provider.id);
        logger.warn('[AI] Provider stream failed', {
          providerId: provider.id,
          error: error instanceof Error ? error.name : 'error',
        });
        // After the first token the user has seen output, and after a tool ran its evidence and progress are
        // out: switching provider would splice two answers or read everything again.
        if (emitted || loop.toolsRan) {
          yield { type: 'error', message: 'The response was interrupted', retryable: true };
          return;
        }
      } finally {
        // Cancelled, whether the abort surfaced as an error or the consumer simply stopped reading: the
        // provider charged for what it produced, so cancelling must never keep that off the budget.
        if (!settled) {
          breakers.release(provider.id);
          await this.finish(
            request,
            {
              usage: unsettledUsage(request, loop, pendingText),
              served: { providerId: provider.id, model: provider.model, fallbackDepth: depth },
            },
            { cancelled: Boolean(request.context.signal?.aborted), usageEstimated: true },
            reservation
          );
        }
        span.end();
      }
    }
    yield { type: 'error', message: 'AI is temporarily unavailable', retryable: true };
  }
}

class GatewayEmbeddingPort implements EmbeddingPort {
  readonly model: string;
  readonly displayModel: string;
  readonly providerId: string;

  constructor(
    private readonly provider: GatewayProvider,
    private readonly settings: AiSettingsView
  ) {
    this.model = embeddingSpaceIdentity(provider);
    this.displayModel = provider.embeddingModel ?? '';
    this.providerId = provider.id;
  }

  async embed(values: string[], context: { actorId: string; signal?: AbortSignal }) {
    const decision = await admitAiRequest(context.actorId, this.settings);
    if (!decision.allowed) throw new AiGatewayError(decision.reason, 'AI limits reached');
    if (!embeddingBreakers.canAttempt(this.provider.id)) {
      throw new AiGatewayError('NO_PROVIDER', 'Embedding provider unavailable');
    }
    const estimate = estimateTokens(values.join('\n'));
    let price: Awaited<ReturnType<typeof priceForModel>>;
    let reservation: AiReservation | null;
    try {
      price = await priceForModel(this.provider.kind, this.provider.embeddingModel);
      reservation = await reserveAiTokens(
        context.actorId,
        this.settings,
        estimate,
        this.settings.requestTimeoutMs * 2 + 60_000,
        new Date(),
        {
          capability: 'EMBED',
          teamId: null,
          costMicros: costMicrosFor({ inputTokens: estimate, outputTokens: 0 }, price),
        }
      );
    } catch (error) {
      // Nothing reached the provider: a half-open probe taken above must be handed back.
      embeddingBreakers.release(this.provider.id);
      throw error;
    }
    const attribution = (tokens: number) => ({
      providerKind: this.provider.kind,
      model: this.provider.embeddingModel ?? this.provider.model,
      capability: 'EMBED',
      teamId: null,
      costMicros: costMicrosFor({ inputTokens: tokens, outputTokens: 0 }, price),
    });
    if (!reservation) {
      embeddingBreakers.release(this.provider.id);
      throw new AiGatewayError('BUDGET_EXHAUSTED', 'Daily AI budget reached');
    }
    let accounted = false;
    const timeout = AbortSignal.timeout(this.settings.requestTimeoutMs);
    try {
      const result = await withSpan(
        'intelligence.ai.embed',
        { 'ai.provider.kind': this.provider.kind, 'ai.values': values.length },
        async () =>
          embedMany({
            model: await buildProviderModel(this.provider, 'embedding'),
            values: values.map(value => redactSecrets(value)),
            maxRetries: 1,
            abortSignal: context.signal ? AbortSignal.any([context.signal, timeout]) : timeout,
          })
      );
      embeddingBreakers.recordSuccess(this.provider.id);
      const tokens = result.usage?.tokens ?? 0;
      accounted = true;
      await recordAiUsage(
        { inputTokens: tokens, outputTokens: 0 },
        new Date(),
        context.actorId,
        reservation,
        attribution(tokens)
      ).catch(() => undefined);
      return { vectors: result.embeddings, tokens };
    } catch (error) {
      if (context.signal?.aborted || !isProviderFault(error, false))
        embeddingBreakers.release(this.provider.id);
      else embeddingBreakers.recordFailure(this.provider.id);
      throw error;
    } finally {
      if (!accounted)
        await recordAiUsage(
          { inputTokens: estimate, outputTokens: 0 },
          new Date(),
          context.actorId,
          reservation,
          attribution(estimate)
        ).catch(() => undefined);
    }
  }
}

/**
 * Pin to the configured first eligible embedding deployment. Breaker state gates calls, not model
 * identity: transient failover would overwrite the single vector per incident and churn the corpus.
 * Administrative provider/clearance/residency changes still take effect on each fresh resolution.
 */
export async function resolveGatewayEmbedding(
  dataClass: AiDataClass
): Promise<EmbeddingPort | null> {
  const { settings, providers } = await loadGatewayData();
  if (!settings.enabled || !settings.embeddingsEnabled) return null;
  const candidates = selectProviderChain(
    providers.filter(provider => Boolean(provider.embeddingModel)),
    dataClass,
    {
      allowExternalFallback: settings.allowExternalFallback,
      allowedRegions: settings.allowedDataRegions,
    }
  );
  const chosen = candidates[0];
  return chosen ? new GatewayEmbeddingPort(chosen, settings) : null;
}

type GatewayData = { settings: AiSettingsView; providers: GatewayProvider[] };
let pendingGatewayData: Promise<GatewayData> | null = null;

export function invalidateGatewayCache(): void {
  pendingGatewayData = null;
}

async function loadGatewayData(): Promise<GatewayData> {
  // Provider clearance and disable switches are authorization decisions. A TTL snapshot can outlive
  // a policy change in another route bundle or process. Share concurrent reads only; every subsequent
  // resolution must observe current persisted policy rather than relying on local invalidation.
  if (pendingGatewayData) return pendingGatewayData;
  const reading = Promise.all([getAiSettings(), loadProvidersForGateway()]).then(
    ([settings, providers]) => ({ settings, providers })
  );
  pendingGatewayData = reading;
  try {
    return await reading;
  } finally {
    if (pendingGatewayData === reading) pendingGatewayData = null;
  }
}

/**
 * Null whenever AI is off, unconfigured, or no provider may receive this data class. With a capability, an
 * administrator's per-capability route (if any) puts its provider and model first; routing only reorders the
 * chain the data policy already allowed, and the rest of that chain remains the fallback.
 */
export async function resolveGatewayPort(
  dataClass: AiDataClass,
  capability?: AiCapability
): Promise<LanguageModelPort | null> {
  const { settings, providers } = await loadGatewayData();
  if (!settings.enabled) return null;
  const eligible = selectProviderChain(providers, dataClass, {
    allowExternalFallback: settings.allowExternalFallback,
    allowedRegions: settings.allowedDataRegions,
  });
  // Default tiers first; an administrator's explicit route is applied on top and wins. Small-tier work
  // (classification, planning hops, phrasing) is always tiered; spend controls also tier the strong work.
  const tiered =
    capability &&
    (settings.spendControlsEnabled ||
      // eslint-disable-next-line security/detect-object-injection -- capability is a closed AiCapability union
      (capability !== 'EMBED' && CAPABILITY_TIERS[capability] === 'small'))
      ? applyDefaultTiers(eligible, capability)
      : eligible;
  const chain = capability
    ? applyCapabilityRoute(tiered, settings.capabilityRouting, capability)
    : tiered;
  return chain.length === 0 ? null : new GatewayPort({ settings, chain });
}

let registered = false;

/** Idempotent. Until this runs, `resolveLanguageModel` reports AI as unavailable. */
export function registerAiGateway(): void {
  if (registered) return;
  registered = true;
  // Replicas share breaker readings best-effort; each still decides from its own state if the table is slow.
  const store = new PostgresBreakerStore();
  breakers.useStore(store);
  embeddingBreakers.useStore(store);
  registerLanguageModelResolver((capability, dataClass) =>
    resolveGatewayPort(dataClass, capability)
  );
  registerEmbeddingResolver(dataClass => resolveGatewayEmbedding(dataClass));
}

export type ProviderTestResult =
  | { ok: true; latencyMs: number }
  | {
      ok: false;
      reason:
        | 'NOT_FOUND'
        | 'MISSING_KEY'
        | 'UNREACHABLE'
        | 'REJECTED'
        | 'TIMEOUT'
        | 'FAILED'
        | 'RATE_LIMITED'
        | 'BUDGET_EXHAUSTED';
    };

/**
 * Sends one tiny fixed prompt to a single saved provider so an administrator can check its address, key
 * and model before relying on it. It uses the same guarded fetch as real traffic. Only a fixed category
 * is returned: provider error bodies can echo request details, so they are never shown or stored.
 */
export async function testProviderConnection(
  providerId: string,
  actorId = 'system:provider-test'
): Promise<ProviderTestResult> {
  const providers = await loadProvidersForGateway(undefined, { includeDisabled: true });
  const provider = providers.find(candidate => candidate.id === providerId);
  if (!provider) return { ok: false, reason: 'NOT_FOUND' };
  // Each kind has its own credential shape (API key, AWS key pair, Google service account); only a kind
  // that may run without one (a local OpenAI-compatible server) is allowed to have none.
  if (provider.kind !== 'OPENAI_COMPATIBLE' && provider.credentials.type === 'none') {
    return { ok: false, reason: 'MISSING_KEY' };
  }
  const settings = await getAiSettings();
  const decision = await admitAiRequest(actorId, settings);
  if (!decision.allowed) return { ok: false, reason: decision.reason };
  const price = await priceForModel(provider.kind, provider.model);
  const attribution = (usage: { inputTokens: number; outputTokens: number }) => ({
    providerKind: provider.kind,
    model: provider.model,
    capability: 'PROVIDER_TEST',
    teamId: null,
    costMicros: costMicrosFor(usage, price),
  });
  const reservation = await reserveAiTokens(actorId, settings, 24, 90_000);
  if (!reservation) return { ok: false, reason: 'BUDGET_EXHAUSTED' };
  let accounted = false;
  const started = Date.now();
  try {
    const result = await generateText({
      model: await buildModel(provider),
      messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
      maxOutputTokens: 16,
      abortSignal: AbortSignal.timeout(15_000),
      maxRetries: 0,
    });
    accounted = true;
    const usage = {
      inputTokens: result.totalUsage.inputTokens ?? 0,
      outputTokens: result.totalUsage.outputTokens ?? 0,
    };
    await recordAiUsage(usage, new Date(), actorId, reservation, attribution(usage)).catch(
      () => undefined
    );
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError'))
      return { ok: false, reason: 'TIMEOUT' };
    if (status === 401 || status === 403 || status === 404 || status === 400)
      return { ok: false, reason: 'REJECTED' };
    if (status === undefined) return { ok: false, reason: 'UNREACHABLE' };
    return { ok: false, reason: 'FAILED' };
  } finally {
    if (!accounted)
      await recordAiUsage(
        { inputTokens: 8, outputTokens: 0 },
        new Date(),
        actorId,
        reservation,
        attribution({ inputTokens: 8, outputTokens: 0 })
      ).catch(() => undefined);
  }
}
