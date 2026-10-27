import 'server-only';
import { generateText, jsonSchema, stepCountIs, streamText, tool, type LanguageModel, type ModelMessage, type ToolSet } from 'ai';
import { logAudit } from '@/lib/audit';
import { logger } from '@/lib/logger';
import { safeOutboundFetch } from '@/lib/network-security';
import { admitAiRequest, recordAiUsage } from './budget';
import { ProviderBreakers } from './breaker';
import { selectProviderChain } from './policy';
import { redactSecrets } from './redact';
import {
  registerLanguageModelResolver,
  type AiDataClass,
  type AiGenerateRequest,
  type AiGenerateResult,
  type AiStreamEvent,
  type AiToolCall,
  type AiToolDefinition,
  type LanguageModelPort,
} from './port';
import { getAiSettings, loadProvidersForGateway, type AiSettingsView, type GatewayProvider } from './settings';

export type AiGatewayErrorCode = 'RATE_LIMITED' | 'BUDGET_EXHAUSTED' | 'NO_PROVIDER' | 'ALL_PROVIDERS_FAILED' | 'ABORTED';

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

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const urlOf = (input: RequestInfo | URL) =>
  typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

/**
 * Every provider request goes through one of two guarded fetches. Public endpoints use the SSRF-safe
 * fetch (HTTPS, public addresses only, no redirects). A private endpoint is reachable only when an
 * administrator consented to it, and then only at the exact origin they approved.
 */
export function guardedFetchFor(provider: Pick<GatewayProvider, 'allowPrivateNetwork' | 'baseUrl'>): FetchFn {
  if (provider.allowPrivateNetwork && provider.baseUrl) {
    const origin = new URL(provider.baseUrl).origin;
    return async (input, init) => {
      const url = new URL(urlOf(input));
      if (url.origin !== origin) throw new Error('Request outside the approved provider origin');
      return fetch(url, { ...init, redirect: 'error' });
    };
  }
  return (input, init) => safeOutboundFetch(urlOf(input), init);
}

async function buildModel(provider: GatewayProvider): Promise<LanguageModel> {
  const fetchImpl = guardedFetchFor(provider) as typeof fetch;
  const common = { apiKey: provider.apiKey ?? undefined, fetch: fetchImpl };
  switch (provider.kind) {
    case 'OPENAI': {
      const { createOpenAI } = await import('@ai-sdk/openai');
      return createOpenAI({ ...common, baseURL: provider.baseUrl ?? undefined }).chat(provider.model);
    }
    case 'ANTHROPIC': {
      const { createAnthropic } = await import('@ai-sdk/anthropic');
      return createAnthropic({ ...common, baseURL: provider.baseUrl ?? undefined })(provider.model);
    }
    case 'GOOGLE': {
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
      return createGoogleGenerativeAI({ ...common, baseURL: provider.baseUrl ?? undefined })(provider.model);
    }
    case 'OPENAI_COMPATIBLE': {
      const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');
      return createOpenAICompatible({ ...common, name: 'compatible', baseURL: provider.baseUrl ?? '' }).chatModel(provider.model);
    }
  }
}

function capOutput(value: unknown): unknown {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  const safe = redactSecrets(text);
  return safe.length > TOOL_OUTPUT_LIMIT ? `${safe.slice(0, TOOL_OUTPUT_LIMIT)}… [truncated]` : safe;
}

function toToolSet(definitions: AiToolDefinition[] | undefined): ToolSet | undefined {
  if (!definitions || definitions.length === 0) return undefined;
  const set: ToolSet = {};
  for (const definition of definitions) {
    const execute = definition.kind === 'READ' ? definition.execute : undefined;
    const inputSchema = jsonSchema<unknown>(definition.inputSchema as Parameters<typeof jsonSchema>[0]);
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
      : tool<unknown, never>({ description: definition.description, inputSchema });
  }
  return set;
}

const toMessages = (request: AiGenerateRequest): ModelMessage[] =>
  request.messages.map(message => ({ role: message.role, content: redactSecrets(message.content) }));

const clampSteps = (steps: number | undefined) => Math.max(1, Math.min(MAX_STEPS_CEILING, steps ?? DEFAULT_MAX_STEPS));

function proposedCalls(
  steps: ReadonlyArray<{ toolCalls: ReadonlyArray<{ toolName: string; input: unknown }> }>,
  definitions: AiToolDefinition[] | undefined
): AiToolCall[] {
  const proposals = new Set((definitions ?? []).filter(d => d.kind === 'PROPOSE_WRITE').map(d => d.name));
  return steps.flatMap(step => step.toolCalls.filter(call => proposals.has(call.toolName)).map(call => ({ name: call.toolName, input: call.input })));
}

interface GatewayContextData {
  settings: AiSettingsView;
  chain: GatewayProvider[];
}

class GatewayPort implements LanguageModelPort {
  constructor(private readonly data: GatewayContextData) {}

  private async admit(request: AiGenerateRequest) {
    const decision = await admitAiRequest(request.context.actorId, this.data.settings);
    if (!decision.allowed) {
      throw new AiGatewayError(decision.reason, decision.reason === 'RATE_LIMITED' ? 'Too many requests' : 'Daily AI budget reached');
    }
  }

  private signalFor(request: AiGenerateRequest): AbortSignal {
    const timeout = AbortSignal.timeout(this.data.settings.requestTimeoutMs);
    return request.context.signal ? AbortSignal.any([request.context.signal, timeout]) : timeout;
  }

  private candidates(): GatewayProvider[] {
    const open = this.data.chain.filter(provider => breakers.canAttempt(provider.id));
    if (open.length === 0) throw new AiGatewayError('NO_PROVIDER', 'No AI provider is currently available');
    return open;
  }

  private async finish(request: AiGenerateRequest, result: AiGenerateResult): Promise<void> {
    await recordAiUsage(result.usage).catch(error =>
      logger.warn('[AI] Could not record usage', { error: error instanceof Error ? error.message : String(error) })
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
      },
    }).catch(() => undefined);
  }

  async generate(request: AiGenerateRequest): Promise<AiGenerateResult> {
    await this.admit(request);
    let attempts = 0;
    for (const [depth, provider] of this.candidates().entries()) {
      attempts += 1;
      try {
        const result = await generateText({
          model: await buildModel(provider),
          messages: toMessages(request),
          tools: toToolSet(request.tools),
          stopWhen: stepCountIs(clampSteps(request.maxSteps)),
          maxOutputTokens: Math.min(request.maxOutputTokens ?? this.data.settings.maxOutputTokens, this.data.settings.maxOutputTokens),
          abortSignal: this.signalFor(request),
          maxRetries: 1,
        });
        breakers.recordSuccess(provider.id);
        const served: AiGenerateResult = {
          text: result.text,
          toolCalls: proposedCalls(result.steps, request.tools),
          usage: { inputTokens: result.totalUsage.inputTokens ?? 0, outputTokens: result.totalUsage.outputTokens ?? 0 },
          served: { providerId: provider.id, model: provider.model, fallbackDepth: depth },
        };
        await this.finish(request, served);
        return served;
      } catch (error) {
        if (request.context.signal?.aborted) throw new AiGatewayError('ABORTED', 'Request cancelled');
        breakers.recordFailure(provider.id);
        logger.warn('[AI] Provider call failed', { providerId: provider.id, error: error instanceof Error ? error.name : 'error' });
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
      yield { type: 'error', message: error instanceof Error ? error.message : 'AI unavailable', retryable: true };
      return;
    }

    for (const [depth, provider] of candidates.entries()) {
      let emitted = false;
      try {
        const run = streamText({
          model: await buildModel(provider),
          messages: toMessages(request),
          tools: toToolSet(request.tools),
          stopWhen: stepCountIs(clampSteps(request.maxSteps)),
          maxOutputTokens: Math.min(request.maxOutputTokens ?? this.data.settings.maxOutputTokens, this.data.settings.maxOutputTokens),
          abortSignal: this.signalFor(request),
          maxRetries: 0,
        });
        let text = '';
        for await (const part of run.fullStream) {
          if (part.type === 'text-delta') {
            emitted = true;
            text += part.text;
            yield { type: 'text-delta', delta: part.text };
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
          usage: { inputTokens: totalUsage.inputTokens ?? 0, outputTokens: totalUsage.outputTokens ?? 0 },
          served: { providerId: provider.id, model: provider.model, fallbackDepth: depth },
        };
        for (const call of result.toolCalls) yield { type: 'tool-call', call };
        await this.finish(request, result);
        yield { type: 'finish', result };
        return;
      } catch (error) {
        if (request.context.signal?.aborted) {
          yield { type: 'error', message: 'Request cancelled', retryable: false };
          return;
        }
        breakers.recordFailure(provider.id);
        logger.warn('[AI] Provider stream failed', { providerId: provider.id, error: error instanceof Error ? error.name : 'error' });
        // After the first token the user has seen output; switching provider would splice two answers.
        if (emitted) {
          yield { type: 'error', message: 'The response was interrupted', retryable: true };
          return;
        }
      }
    }
    yield { type: 'error', message: 'AI is temporarily unavailable', retryable: true };
  }
}

let cache: { at: number; data: { settings: AiSettingsView; providers: GatewayProvider[] } } | null = null;

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
export async function resolveGatewayPort(dataClass: AiDataClass): Promise<LanguageModelPort | null> {
  const { settings, providers } = await loadGatewayData();
  if (!settings.enabled) return null;
  const chain = selectProviderChain(providers, dataClass, { allowExternalFallback: settings.allowExternalFallback });
  return chain.length === 0 ? null : new GatewayPort({ settings, chain });
}

let registered = false;

/** Idempotent. Until this runs, `resolveLanguageModel` reports AI as unavailable. */
export function registerAiGateway(): void {
  if (registered) return;
  registered = true;
  registerLanguageModelResolver((_capability, dataClass) => resolveGatewayPort(dataClass));
}
