import 'server-only';
import {
  Output,
  embedMany,
  generateText,
  jsonSchema,
  stepCountIs,
  streamText,
  tool,
  zodSchema,
  type EmbeddingModel,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
} from 'ai';
import { logAudit } from '@/lib/audit';
import { logger } from '@/lib/logger';
import { failSpan, startSpan, withSpan } from '../telemetry';
import { safeOutboundFetch } from '@/lib/network-security';
import { assertNotMetadataEndpoint } from './egress';
import {
  admitAiRequest,
  estimateTokens,
  recordAiUsage,
  reserveAiTokens,
  type AiReservation,
} from './budget';
import { ProviderBreakers } from './breaker';
import { AI_SETTINGS_BOUNDS } from './contract';
import { selectProviderChain } from './policy';
import { redactSecrets } from './redact';
import {
  registerEmbeddingResolver,
  registerLanguageModelResolver,
  type AiDataClass,
  type AiStructuredRequest,
  type AiStructuredResult,
  type EmbeddingPort,
  type AiGenerateRequest,
  type AiGenerateResult,
  type AiStreamEvent,
  type AiToolCall,
  type AiToolDefinition,
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
  | 'OUTPUT_INVALID';

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
const CACHE_TTL_MS = 5_000;

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

function capOutput(value: unknown): unknown {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  const safe = redactSecrets(text);
  return safe.length > TOOL_OUTPUT_LIMIT
    ? `${safe.slice(0, TOOL_OUTPUT_LIMIT)}… [truncated]`
    : safe;
}

function toToolSet(definitions: AiToolDefinition[] | undefined): ToolSet | undefined {
  if (!definitions || definitions.length === 0) return undefined;
  const set: ToolSet = {};
  for (const definition of definitions) {
    const execute = definition.kind === 'READ' ? definition.execute : undefined;
    const inputSchema = jsonSchema<unknown>(
      definition.inputSchema as Parameters<typeof jsonSchema>[0]
    );
    set[definition.name] = execute
      ? tool<unknown, unknown>({
          description: definition.description,
          inputSchema,
          execute: async (input: unknown) => {
            try {
              return capOutput(await execute(input));
            } catch {
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
          execute: async () => PROPOSAL_ACKNOWLEDGEMENT,
        });
  }
  return set;
}

const PROPOSAL_ACKNOWLEDGEMENT =
  'Shown to the user as a suggestion card. It happens only if they confirm it; do not say it has been done.';

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

const clampSteps = (steps: number | undefined) =>
  Math.max(1, Math.min(MAX_STEPS_CEILING, steps ?? DEFAULT_MAX_STEPS));

function proposedCalls(
  steps: ReadonlyArray<{ toolCalls: ReadonlyArray<{ toolName: string; input: unknown }> }>,
  definitions: AiToolDefinition[] | undefined
): AiToolCall[] {
  const proposals = new Set(
    (definitions ?? []).filter(d => d.kind === 'PROPOSE_WRITE').map(d => d.name)
  );
  return steps.flatMap(step =>
    step.toolCalls
      .filter(call => proposals.has(call.toolName))
      .map(call => ({ name: call.toolName, input: call.input }))
  );
}

interface GatewayContextData {
  settings: AiSettingsView;
  chain: GatewayProvider[];
}

/** Prompt size estimate for a call that ended before the provider reported usage. */
function estimatedInput(request: AiGenerateRequest): number {
  return estimateTokens(request.messages.map(message => message.content).join('\n'));
}

class GatewayPort implements LanguageModelPort {
  constructor(private readonly data: GatewayContextData) {}

  private async admit(request: AiGenerateRequest) {
    const decision = await admitAiRequest(request.context.actorId, this.data.settings);
    if (!decision.allowed) {
      throw new AiGatewayError(
        decision.reason,
        decision.reason === 'RATE_LIMITED' ? 'Too many requests' : 'Daily AI budget reached'
      );
    }
  }

  private async reserve(request: AiGenerateRequest, provider: GatewayProvider, structured = false) {
    const steps = request.tools?.length ? clampSteps(request.maxSteps) : 1;
    const output = structured
      ? Math.min(
          request.maxOutputTokens ?? this.data.settings.maxOutputTokens,
          AI_SETTINGS_BOUNDS.maxOutputTokens.max
        )
      : Math.min(
          request.maxOutputTokens ?? this.data.settings.maxOutputTokens,
          this.data.settings.maxOutputTokens
        );
    const estimate =
      (estimatedInput(request) +
        estimateTokens(
          JSON.stringify(
            request.tools?.map(tool => ({ name: tool.name, description: tool.description })) ?? []
          )
        ) +
        output) *
      steps;
    try {
      const reservation = await reserveAiTokens(
        request.context.actorId,
        this.data.settings,
        estimate,
        this.data.settings.requestTimeoutMs * (this.data.chain.length + 1) + 60_000
      );
      if (!reservation) throw new AiGatewayError('BUDGET_EXHAUSTED', 'Daily AI budget reached');
      return reservation;
    } catch (error) {
      breakers.release(provider.id);
      throw error;
    }
  }

  private signalFor(request: AiGenerateRequest): AbortSignal {
    const timeout = AbortSignal.timeout(this.data.settings.requestTimeoutMs);
    return request.context.signal ? AbortSignal.any([request.context.signal, timeout]) : timeout;
  }

  private candidates(): GatewayProvider[] {
    const open = this.data.chain.filter(provider => breakers.available(provider.id));
    if (open.length === 0)
      throw new AiGatewayError('NO_PROVIDER', 'No AI provider is currently available');
    return open;
  }

  private async finish(
    request: AiGenerateRequest,
    result: Pick<AiGenerateResult, 'usage' | 'served'>,
    extra: Record<string, string | number | boolean> = {},
    reservation?: AiReservation
  ): Promise<void> {
    await recordAiUsage(result.usage, new Date(), request.context.actorId, reservation).catch(
      error =>
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

  async generateStructured<T>(request: AiStructuredRequest<T>): Promise<AiStructuredResult<T>> {
    await this.admit(request);
    let attempts = 0;
    let invalidOutputs = 0;
    for (const [depth, provider] of this.candidates().entries()) {
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
              maxOutputTokens: Math.min(
                request.maxOutputTokens ?? this.data.settings.maxOutputTokens,
                Math.max(this.data.settings.maxOutputTokens, AI_SETTINGS_BOUNDS.maxOutputTokens.max)
              ),
              abortSignal: this.signalFor(request),
              maxRetries: 1,
            });
            span.setAttribute('ai.tokens.input', generated.totalUsage.inputTokens ?? 0);
            span.setAttribute('ai.tokens.output', generated.totalUsage.outputTokens ?? 0);
            return generated;
          }
        );
        const usage = {
          inputTokens: result.totalUsage.inputTokens ?? 0,
          outputTokens: result.totalUsage.outputTokens ?? 0,
        };
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
        return { object: checked.data, usage, served };
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
        breakers.recordFailure(provider.id);
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
    for (const [depth, provider] of this.candidates().entries()) {
      if (!breakers.canAttempt(provider.id)) continue;
      const reservation = await this.reserve(request, provider);
      let accounted = false;
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
              stopWhen: stepCountIs(clampSteps(request.maxSteps)),
              maxOutputTokens: Math.min(
                request.maxOutputTokens ?? this.data.settings.maxOutputTokens,
                this.data.settings.maxOutputTokens
              ),
              abortSignal: this.signalFor(request),
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
          usage: {
            inputTokens: result.totalUsage.inputTokens ?? 0,
            outputTokens: result.totalUsage.outputTokens ?? 0,
          },
          served: { providerId: provider.id, model: provider.model, fallbackDepth: depth },
        };
        accounted = true;
        await this.finish(request, served, {}, reservation);
        return served;
      } catch (error) {
        if (request.context.signal?.aborted) {
          breakers.release(provider.id);
          throw new AiGatewayError('ABORTED', 'Request cancelled');
        }
        breakers.recordFailure(provider.id);
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
    throw new AiGatewayError('ALL_PROVIDERS_FAILED', `All ${attempts} AI provider attempts failed`);
  }

  async *stream(request: AiGenerateRequest): AsyncIterable<AiStreamEvent> {
    try {
      await this.admit(request);
    } catch (error) {
      if (error instanceof AiGatewayError) {
        yield { type: 'error', message: error.message, retryable: error.code === 'RATE_LIMITED' };
        return;
      }
      throw error;
    }
    let candidates: GatewayProvider[];
    try {
      candidates = this.candidates();
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
      } catch {
        yield { type: 'error', message: 'Daily AI budget reached', retryable: false };
        return;
      }
      let emitted = false;
      let text = '';
      // Set once this attempt's usage is accounted for (finished, or failed on the provider's side).
      let settled = false;
      const span = startSpan('intelligence.ai.stream', {
        'ai.capability': request.context.capability,
        'ai.provider.kind': provider.kind,
        'ai.fallback.depth': depth,
      });
      try {
        const run = streamText({
          model: await buildModel(provider),
          messages: toMessages(request, provider.kind),
          tools: toToolSet(request.tools),
          stopWhen: stepCountIs(clampSteps(request.maxSteps)),
          maxOutputTokens: Math.min(
            request.maxOutputTokens ?? this.data.settings.maxOutputTokens,
            this.data.settings.maxOutputTokens
          ),
          abortSignal: this.signalFor(request),
          maxRetries: 0,
        });
        const proposals = new Set(
          (request.tools ?? []).filter(d => d.kind === 'PROPOSE_WRITE').map(d => d.name)
        );
        for await (const part of run.fullStream) {
          if (part.type === 'text-delta') {
            emitted = true;
            text += part.text;
            yield { type: 'text-delta', delta: part.text };
          } else if (part.type === 'tool-call') {
            // Something has been shown once a proposal is out, so a later failure must not switch provider.
            if (proposals.has(part.toolName)) {
              emitted = true;
              yield { type: 'tool-call', call: { name: part.toolName, input: part.input } };
            } else {
              yield { type: 'tool-start', name: part.toolName };
            }
          } else if (part.type === 'error') {
            throw part.error instanceof Error ? part.error : new Error('stream error');
          }
        }
        breakers.recordSuccess(provider.id);
        const steps = await run.steps;
        const totalUsage = await run.totalUsage;
        const result: AiGenerateResult = {
          text,
          toolCalls: proposedCalls(steps, request.tools),
          usage: {
            inputTokens: totalUsage.inputTokens ?? 0,
            outputTokens: totalUsage.outputTokens ?? 0,
          },
          served: { providerId: provider.id, model: provider.model, fallbackDepth: depth },
        };
        span.setAttribute('ai.tokens.input', result.usage.inputTokens);
        span.setAttribute('ai.tokens.output', result.usage.outputTokens);
        settled = true;
        await this.finish(request, result, {}, reservation);
        yield { type: 'finish', result };
        return;
      } catch (error) {
        failSpan(span, error);
        if (request.context.signal?.aborted) {
          yield { type: 'error', message: 'Request cancelled', retryable: false };
          return;
        }
        breakers.recordFailure(provider.id);
        logger.warn('[AI] Provider stream failed', {
          providerId: provider.id,
          error: error instanceof Error ? error.name : 'error',
        });
        // After the first token the user has seen output; switching provider would splice two answers.
        if (emitted) {
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
              usage: { inputTokens: estimatedInput(request), outputTokens: estimateTokens(text) },
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
  readonly providerId: string;

  constructor(
    private readonly provider: GatewayProvider,
    private readonly settings: AiSettingsView
  ) {
    this.model = `${provider.kind}:${provider.embeddingModel}`;
    this.providerId = provider.id;
  }

  async embed(values: string[], context: { actorId: string; signal?: AbortSignal }) {
    const decision = await admitAiRequest(context.actorId, this.settings);
    if (!decision.allowed) throw new AiGatewayError(decision.reason, 'AI limits reached');
    if (!embeddingBreakers.canAttempt(this.provider.id)) {
      throw new AiGatewayError('NO_PROVIDER', 'Embedding provider unavailable');
    }
    const estimate = estimateTokens(values.join('\n'));
    const reservation = await reserveAiTokens(
      context.actorId,
      this.settings,
      estimate,
      this.settings.requestTimeoutMs * 2 + 60_000
    );
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
        reservation
      ).catch(() => undefined);
      return { vectors: result.embeddings, tokens };
    } catch (error) {
      if (context.signal?.aborted) embeddingBreakers.release(this.provider.id);
      else embeddingBreakers.recordFailure(this.provider.id);
      throw error;
    } finally {
      if (!accounted)
        await recordAiUsage(
          { inputTokens: estimate, outputTokens: 0 },
          new Date(),
          context.actorId,
          reservation
        ).catch(() => undefined);
    }
  }
}

/** The first eligible provider with an embedding model, under the same data-class and residency rules. */
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
  const chosen = candidates.find(provider => embeddingBreakers.available(provider.id));
  return chosen ? new GatewayEmbeddingPort(chosen, settings) : null;
}

let cache: { at: number; data: { settings: AiSettingsView; providers: GatewayProvider[] } } | null =
  null;

export function invalidateGatewayCache(): void {
  cache = null;
}

async function loadGatewayData() {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;
  const [settings, providers] = await Promise.all([getAiSettings(), loadProvidersForGateway()]);
  cache = { at: Date.now(), data: { settings, providers } };
  return cache.data;
}

/** Null whenever AI is off, unconfigured, or no provider may receive this data class. */
export async function resolveGatewayPort(
  dataClass: AiDataClass
): Promise<LanguageModelPort | null> {
  const { settings, providers } = await loadGatewayData();
  if (!settings.enabled) return null;
  const chain = selectProviderChain(providers, dataClass, {
    allowExternalFallback: settings.allowExternalFallback,
    allowedRegions: settings.allowedDataRegions,
  });
  return chain.length === 0 ? null : new GatewayPort({ settings, chain });
}

let registered = false;

/** Idempotent. Until this runs, `resolveLanguageModel` reports AI as unavailable. */
export function registerAiGateway(): void {
  if (registered) return;
  registered = true;
  registerLanguageModelResolver((_capability, dataClass) => resolveGatewayPort(dataClass));
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
    await recordAiUsage(
      {
        inputTokens: result.totalUsage.inputTokens ?? 0,
        outputTokens: result.totalUsage.outputTokens ?? 0,
      },
      new Date(),
      actorId,
      reservation
    ).catch(() => undefined);
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
        reservation
      ).catch(() => undefined);
  }
}
