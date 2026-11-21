/**
 * Model price table and budget arithmetic. Pure: no database, no clock, no environment, so it is the same
 * in the gateway, the settings page and the tests.
 *
 * Prices are US dollars per million tokens. Costs are integers in millionths of a dollar ("micros"), so a
 * token count multiplied by a per-million price is already in micros and sums never drift.
 *
 * Built-in prices are public list prices captured when this table was written. They are a starting point,
 * not a quote: contracts, regions, batch or cached-token discounts and provider price changes all differ, so
 * an administrator can override any provider kind and model on the AI settings page. A model with neither
 * an override nor a built-in price is "unpriced": its tokens still count toward token budgets, but it adds
 * no dollars (and the usage page says so).
 */

export const PROVIDER_KINDS = [
  'OPENAI',
  'ANTHROPIC',
  'GOOGLE',
  'OPENAI_COMPATIBLE',
  'AZURE_OPENAI',
  'BEDROCK',
  'VERTEX',
  'MISTRAL',
  'GROQ',
] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

export interface ModelPrice {
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
  /**
   * Prompt-cache rates. Absent means the provider's cached tokens are charged at the full input rate: a
   * conservative default that can overstate, never understate, spend for a family whose discount is unknown.
   */
  cacheReadUsdPerMTok?: number;
  cacheWriteUsdPerMTok?: number;
}

export interface ResolvedModelPrice extends ModelPrice {
  source: 'override' | 'built-in';
}

export interface ModelPriceOverride extends ModelPrice {
  providerKind: ProviderKind;
  model: string;
}

interface BuiltInPrice extends ModelPrice {
  /** Model family prefix, matched against the normalised model id (longest prefix wins). */
  prefix: string;
  kinds: readonly ProviderKind[];
}

const ANTHROPIC_HOSTS: readonly ProviderKind[] = ['ANTHROPIC', 'BEDROCK', 'VERTEX'];
const OPENAI_HOSTS: readonly ProviderKind[] = ['OPENAI', 'AZURE_OPENAI'];
const GOOGLE_HOSTS: readonly ProviderKind[] = ['GOOGLE', 'VERTEX'];
const MISTRAL_HOSTS: readonly ProviderKind[] = ['MISTRAL', 'BEDROCK', 'VERTEX'];

const p = (
  prefix: string,
  kinds: readonly ProviderKind[],
  inputUsdPerMTok: number,
  outputUsdPerMTok: number
): BuiltInPrice => ({ prefix, kinds, inputUsdPerMTok, outputUsdPerMTok });

/** List prices (USD per million tokens). Override on the settings page for negotiated or regional rates. */
export const BUILT_IN_MODEL_PRICES: readonly BuiltInPrice[] = [
  // Anthropic (first-party list prices; Bedrock and Vertex list the same rates for these families).
  p('claude-fable-5', ANTHROPIC_HOSTS, 10, 50),
  p('claude-opus-5-5', ANTHROPIC_HOSTS, 4, 20),
  p('claude-opus-5', ANTHROPIC_HOSTS, 5, 25),
  p('claude-opus-4-8', ANTHROPIC_HOSTS, 5, 25),
  p('claude-opus-4-7', ANTHROPIC_HOSTS, 5, 25),
  p('claude-opus-4-6', ANTHROPIC_HOSTS, 5, 25),
  p('claude-opus-4-5', ANTHROPIC_HOSTS, 5, 25),
  p('claude-opus-4', ANTHROPIC_HOSTS, 15, 75),
  p('claude-3-opus', ANTHROPIC_HOSTS, 15, 75),
  p('claude-sonnet-5', ANTHROPIC_HOSTS, 2, 10),
  p('claude-sonnet-4', ANTHROPIC_HOSTS, 3, 15),
  p('claude-3-7-sonnet', ANTHROPIC_HOSTS, 3, 15),
  p('claude-3-5-sonnet', ANTHROPIC_HOSTS, 3, 15),
  p('claude-haiku-5-5', ANTHROPIC_HOSTS, 0.1, 0.5),
  p('claude-haiku-4-5', ANTHROPIC_HOSTS, 1, 5),
  p('claude-3-5-haiku', ANTHROPIC_HOSTS, 0.8, 4),
  p('claude-3-haiku', ANTHROPIC_HOSTS, 0.25, 1.25),
  // OpenAI (and Azure OpenAI deployments named after the model).
  p('gpt-5-nano', OPENAI_HOSTS, 0.05, 0.4),
  p('gpt-5-mini', OPENAI_HOSTS, 0.25, 2),
  p('gpt-5', OPENAI_HOSTS, 1.25, 10),
  p('gpt-4.1-nano', OPENAI_HOSTS, 0.1, 0.4),
  p('gpt-4.1-mini', OPENAI_HOSTS, 0.4, 1.6),
  p('gpt-4.1', OPENAI_HOSTS, 2, 8),
  p('gpt-4o-mini', OPENAI_HOSTS, 0.15, 0.6),
  p('gpt-4o', OPENAI_HOSTS, 2.5, 10),
  p('gpt-4-turbo', OPENAI_HOSTS, 10, 30),
  p('gpt-3.5-turbo', OPENAI_HOSTS, 0.5, 1.5),
  p('o4-mini', OPENAI_HOSTS, 1.1, 4.4),
  p('o3-mini', OPENAI_HOSTS, 1.1, 4.4),
  p('o3', OPENAI_HOSTS, 2, 8),
  p('o1-mini', OPENAI_HOSTS, 1.1, 4.4),
  p('o1', OPENAI_HOSTS, 15, 60),
  p('text-embedding-3-small', OPENAI_HOSTS, 0.02, 0),
  p('text-embedding-3-large', OPENAI_HOSTS, 0.13, 0),
  p('text-embedding-ada-002', OPENAI_HOSTS, 0.1, 0),
  // Google Gemini (AI Studio and Vertex).
  p('gemini-2.5-pro', GOOGLE_HOSTS, 1.25, 10),
  p('gemini-2.5-flash-lite', GOOGLE_HOSTS, 0.1, 0.4),
  p('gemini-2.5-flash', GOOGLE_HOSTS, 0.3, 2.5),
  p('gemini-2.0-flash-lite', GOOGLE_HOSTS, 0.075, 0.3),
  p('gemini-2.0-flash', GOOGLE_HOSTS, 0.1, 0.4),
  p('gemini-1.5-pro', GOOGLE_HOSTS, 1.25, 5),
  p('gemini-1.5-flash', GOOGLE_HOSTS, 0.075, 0.3),
  p('gemini-embedding', GOOGLE_HOSTS, 0.15, 0),
  p('text-embedding-004', GOOGLE_HOSTS, 0.025, 0),
  // Mistral.
  p('mistral-large', MISTRAL_HOSTS, 2, 6),
  p('mistral-medium', MISTRAL_HOSTS, 0.4, 2),
  p('mistral-small', MISTRAL_HOSTS, 0.1, 0.3),
  p('ministral-8b', MISTRAL_HOSTS, 0.1, 0.1),
  p('ministral-3b', MISTRAL_HOSTS, 0.04, 0.04),
  p('codestral', MISTRAL_HOSTS, 0.3, 0.9),
  p('open-mistral-nemo', MISTRAL_HOSTS, 0.15, 0.15),
  p('mistral-embed', MISTRAL_HOSTS, 0.1, 0),
  // Groq-hosted open models.
  p('llama-3.3-70b', ['GROQ'], 0.59, 0.79),
  p('llama-3.1-70b', ['GROQ'], 0.59, 0.79),
  p('llama-3.1-8b', ['GROQ'], 0.05, 0.08),
  p('llama3-70b', ['GROQ'], 0.59, 0.79),
  p('llama3-8b', ['GROQ'], 0.05, 0.08),
  p('mixtral-8x7b', ['GROQ'], 0.24, 0.24),
  p('gemma2-9b', ['GROQ'], 0.2, 0.2),
  // OPENAI_COMPATIBLE has no built-in price: it is usually self-hosted. Add an override when it is not.
];

/**
 * Lower-cases and strips hosting decorations so one family entry covers every host's spelling:
 * Bedrock "us.anthropic.claude-sonnet-4-20250514-v1:0", Vertex "claude-3-5-sonnet@20240620",
 * Google "models/gemini-2.5-pro", OpenAI-style "openai/gpt-4o".
 */
export function normaliseModelId(model: string): string {
  let id = model.trim().toLowerCase();
  id = id.replace(/^models\//, '');
  // Bedrock: optional cross-region prefix ("us.", "global.") then a vendor prefix ("anthropic.").
  const vendors = new Set(['anthropic', 'meta', 'mistral', 'amazon', 'cohere', 'ai21', 'google']);
  const parts = id.split('.');
  if (parts.length > 2 && vendors.has(parts[1]) && /^[a-z]{2,6}$/.test(parts[0]))
    id = parts.slice(2).join('.');
  else if (parts.length > 1 && vendors.has(parts[0])) id = parts.slice(1).join('.');
  id = id.replace(/^[a-z0-9-]+\//, '');
  id = id.replace(/@.*$/, '');
  return id;
}

/**
 * Anthropic prompt caching: a cache read costs about 0.1x the input rate and a 5-minute cache write (the
 * only kind the gateway requests) about 1.25x. Applied to Claude families on every host that serves them,
 * on top of whichever input price resolved (built-in or override). Other families keep the full input rate.
 */
export const CLAUDE_CACHE_READ_MULTIPLIER = 0.1;
export const CLAUDE_CACHE_WRITE_MULTIPLIER = 1.25;

function withCacheRates<T extends ModelPrice>(kind: ProviderKind, model: string, price: T): T {
  if (!ANTHROPIC_HOSTS.includes(kind) || !normaliseModelId(model).startsWith('claude'))
    return price;
  return {
    ...price,
    cacheReadUsdPerMTok: price.inputUsdPerMTok * CLAUDE_CACHE_READ_MULTIPLIER,
    cacheWriteUsdPerMTok: price.inputUsdPerMTok * CLAUDE_CACHE_WRITE_MULTIPLIER,
  };
}

const validPrice = (value: number) => Number.isFinite(value) && value >= 0 && value <= 100_000;

/**
 * Override first (exact provider kind and model, case-insensitive), then the longest built-in family prefix
 * available on that provider kind. Null means unpriced.
 */
export function resolveModelPrice(
  kind: ProviderKind,
  model: string,
  overrides: readonly ModelPriceOverride[] = []
): ResolvedModelPrice | null {
  const wanted = model.trim().toLowerCase();
  const override = overrides.find(
    row => row.providerKind === kind && row.model.trim().toLowerCase() === wanted
  );
  if (override && validPrice(override.inputUsdPerMTok) && validPrice(override.outputUsdPerMTok))
    return withCacheRates(kind, model, {
      inputUsdPerMTok: override.inputUsdPerMTok,
      outputUsdPerMTok: override.outputUsdPerMTok,
      source: 'override' as const,
    });
  const id = normaliseModelId(model);
  let best: BuiltInPrice | null = null;
  for (const entry of BUILT_IN_MODEL_PRICES) {
    if (!entry.kinds.includes(kind) || !id.startsWith(entry.prefix)) continue;
    if (!best || entry.prefix.length > best.prefix.length) best = entry;
  }
  return best
    ? withCacheRates(kind, model, {
        inputUsdPerMTok: best.inputUsdPerMTok,
        outputUsdPerMTok: best.outputUsdPerMTok,
        source: 'built-in' as const,
      })
    : null;
}

const tokens = (value: number) => Math.max(0, Math.trunc(Number.isFinite(value) ? value : 0));

/** Cost in millionths of a dollar: tokens × (USD per million tokens) is already micros. Null when unpriced. */
export interface PricedUsage {
  /** Every prompt token, cached ones included. */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/** Splits the prompt into uncached, cache-read and cache-write tokens; the parts never exceed the total. */
function inputParts(usage: PricedUsage) {
  const total = tokens(usage.inputTokens);
  const read = Math.min(total, tokens(usage.cacheReadTokens ?? 0));
  const write = Math.min(total - read, tokens(usage.cacheWriteTokens ?? 0));
  return { plain: total - read - write, read, write };
}

export function costMicrosFor(usage: PricedUsage, price: ModelPrice | null): number | null {
  if (!price) return null;
  const { plain, read, write } = inputParts(usage);
  return Math.round(
    plain * price.inputUsdPerMTok +
      read * (price.cacheReadUsdPerMTok ?? price.inputUsdPerMTok) +
      write * (price.cacheWriteUsdPerMTok ?? price.inputUsdPerMTok) +
      tokens(usage.outputTokens) * price.outputUsdPerMTok
  );
}

/**
 * What the provider's prompt cache saved on one call against paying the full input rate for every prompt
 * token. Negative when a call only wrote the cache (the write premium); the sum over a period is the net.
 */
export function providerCacheSavedMicros(usage: PricedUsage, price: ModelPrice | null): number {
  if (!price) return 0;
  const { read, write } = inputParts(usage);
  return Math.round(
    read * (price.inputUsdPerMTok - (price.cacheReadUsdPerMTok ?? price.inputUsdPerMTok)) -
      write * ((price.cacheWriteUsdPerMTok ?? price.inputUsdPerMTok) - price.inputUsdPerMTok)
  );
}

export const microsToUsd = (micros: number | bigint | null | undefined) =>
  micros === null || micros === undefined ? 0 : Number(micros) / 1_000_000;

export const usdToMicros = (usd: number) => Math.round(usd * 1_000_000);

/** "$0.00" for display; amounts under a cent show four decimals so small daily spend is still visible. */
export function formatUsd(micros: number | bigint | null | undefined): string {
  const usd = microsToUsd(micros);
  const digits = usd !== 0 && Math.abs(usd) < 0.01 ? 4 : 2;
  return `$${usd.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export type BudgetScope = 'TEAM' | 'CAPABILITY';

export interface BudgetLimits {
  dailyTokenLimit: number | null;
  dailyCostLimitMicros: number | null;
}

export interface BudgetConsumption {
  /** Settled tokens plus live reservations for the UTC day. */
  tokens: number;
  costMicros: number;
}

/** True when adding the request would exceed either configured limit. A missing limit never blocks. */
export function wouldExceed(
  limits: BudgetLimits,
  current: BudgetConsumption,
  request: BudgetConsumption
): boolean {
  if (limits.dailyTokenLimit !== null && current.tokens + request.tokens > limits.dailyTokenLimit)
    return true;
  return (
    limits.dailyCostLimitMicros !== null &&
    request.costMicros > 0 &&
    current.costMicros + request.costMicros > limits.dailyCostLimitMicros
  );
}

/** Highest of the token and dollar utilisation ratios (0 when no limit is set). */
export function budgetUtilization(limits: BudgetLimits, current: BudgetConsumption): number {
  const ratios: number[] = [0];
  if (limits.dailyTokenLimit !== null)
    ratios.push(limits.dailyTokenLimit > 0 ? current.tokens / limits.dailyTokenLimit : 1);
  if (limits.dailyCostLimitMicros !== null)
    ratios.push(
      limits.dailyCostLimitMicros > 0 ? current.costMicros / limits.dailyCostLimitMicros : 1
    );
  return Math.max(...ratios);
}

export const BUDGET_ALERT_THRESHOLDS = [0.8, 1] as const;

export const budgetKey = (scope: BudgetScope, subject: string) =>
  `${scope === 'TEAM' ? 'team' : 'capability'}:${subject}`;
