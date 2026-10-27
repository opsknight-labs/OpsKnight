/**
 * Provider-neutral language-model port. Squire, copilot features and the AI gateway all depend on
 * this contract and never on a vendor SDK, so the runtime can change (for example AI SDK 6 -> 7
 * after a separately certified Node 22 upgrade) by replacing one adapter.
 *
 * Safety properties every implementation must keep:
 *  - the port is absent (resolver returns null) until an administrator configures a provider; callers
 *    must then fall back to deterministic behaviour
 *  - model output is untrusted data and is never authorization; tools execute under the actor's
 *    real permissions and writes are proposals that need explicit confirmation
 *  - data leaves the process only through a provider whose data policy allows the request's class
 */

/** Ordered from least to most sensitive. A provider may carry data up to its configured ceiling. */
export const AI_DATA_CLASSES = ['PUBLIC', 'INTERNAL', 'PERSONAL', 'SENSITIVE'] as const;
export type AiDataClass = (typeof AI_DATA_CLASSES)[number];

export const AI_CAPABILITIES = [
  'SQUIRE_CHAT',
  'SUMMARIZE',
  'DIAGNOSE',
  'POSTMORTEM',
  'CLASSIFY',
  'EMBED',
] as const;
export type AiCapability = (typeof AI_CAPABILITIES)[number];

export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Who is asking and for what; used for budgets, audit and data-policy checks. */
export interface AiRequestContext {
  actorId: string;
  capability: AiCapability;
  /** Highest classification of any data included in the messages. */
  dataClass: AiDataClass;
  incidentId?: string;
  /** Aborts the call (user navigated away, budget exceeded, timeout). */
  signal?: AbortSignal;
}

export interface AiToolDefinition {
  name: string;
  description: string;
  /** JSON-schema-shaped description of the input; validated again by the tool itself. */
  inputSchema: Record<string, unknown>;
  /** Read tools run automatically. Write tools only ever return a proposal for user confirmation. */
  kind: 'READ' | 'PROPOSE_WRITE';
}

export interface AiToolCall {
  name: string;
  input: unknown;
}

export interface AiGenerateRequest {
  context: AiRequestContext;
  messages: AiMessage[];
  tools?: AiToolDefinition[];
  maxOutputTokens?: number;
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AiGenerateResult {
  text: string;
  toolCalls: AiToolCall[];
  usage: AiUsage;
  /** Which route/provider/model actually served the request, for audit and the status chip. */
  served: { providerId: string; model: string; fallbackDepth: number };
}

export type AiStreamEvent =
  | { type: 'text-delta'; delta: string }
  | { type: 'tool-call'; call: AiToolCall }
  | { type: 'finish'; result: AiGenerateResult }
  | { type: 'error'; message: string; retryable: boolean };

export interface LanguageModelPort {
  generate(request: AiGenerateRequest): Promise<AiGenerateResult>;
  stream(request: AiGenerateRequest): AsyncIterable<AiStreamEvent>;
}

/**
 * Resolves the configured model for a capability, or null when AI is not configured, disabled,
 * over budget, or no provider is allowed to receive this request's data class. Null always means
 * "use the deterministic path"; callers never treat it as an error.
 */
export type LanguageModelResolver = (
  capability: AiCapability,
  dataClass: AiDataClass
) => Promise<LanguageModelPort | null>;

let resolver: LanguageModelResolver = async () => null;

/** The AI gateway registers itself here; until then AI is reported as unavailable. */
export function registerLanguageModelResolver(next: LanguageModelResolver): void {
  resolver = next;
}

export async function resolveLanguageModel(
  capability: AiCapability,
  dataClass: AiDataClass
): Promise<LanguageModelPort | null> {
  try {
    return await resolver(capability, dataClass);
  } catch {
    // A broken gateway must degrade to the deterministic path, never break the caller.
    return null;
  }
}

/** True when `candidate` may carry data of `required` classification. */
export function dataClassAllows(candidate: AiDataClass, required: AiDataClass): boolean {
  return AI_DATA_CLASSES.indexOf(candidate) >= AI_DATA_CLASSES.indexOf(required);
}
