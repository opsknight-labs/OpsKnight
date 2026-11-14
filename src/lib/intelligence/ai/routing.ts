import { z } from 'zod/v4';
import type { AiCapability } from './port';
import type { ProviderKind } from './pricing';

/**
 * Per-capability model routing. An administrator may send a capability (cheap classification hops, strong
 * diagnosis) to a preferred provider and, optionally, a different model on that provider. Routing only ever
 * reorders the chain the data policy already allowed: it can never make a provider eligible that is not
 * cleared for the request's data class, region or external-fallback policy, and every other eligible
 * provider stays behind it as fallback. Unset means the existing priority chain, unchanged.
 */
export const ROUTABLE_CAPABILITIES = [
  'SQUIRE_CHAT',
  'SUMMARIZE',
  'DIAGNOSE',
  'POSTMORTEM',
  'CLASSIFY',
] as const satisfies readonly AiCapability[];
export type RoutableCapability = (typeof ROUTABLE_CAPABILITIES)[number];

export const CAPABILITY_ROUTE_LABELS: Readonly<Record<RoutableCapability, string>> = {
  SQUIRE_CHAT: 'Assistant conversation',
  SUMMARIZE: 'Summaries (earlier conversation turns)',
  DIAGNOSE: 'Investigation conclusions',
  POSTMORTEM: 'Postmortem drafts',
  CLASSIFY: 'Classification and investigation planning (cheap, frequent)',
};

const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,127}$/;

export const capabilityRouteSchema = z
  .object({
    providerId: z.string().trim().min(1).max(64),
    /** Overrides the provider's model for this capability only. */
    model: z
      .string()
      .trim()
      .regex(MODEL, 'Use the model name exactly as the provider spells it')
      .optional(),
  })
  .strict();
export type CapabilityRoute = z.infer<typeof capabilityRouteSchema>;

export const capabilityRoutingSchema = z
  .partialRecord(z.enum(ROUTABLE_CAPABILITIES), capabilityRouteSchema)
  .default({});
export type CapabilityRouting = Partial<Record<RoutableCapability, CapabilityRoute>>;

/** Stored JSON is re-validated on every read; anything unexpected means "no routing" for that entry. */
export function readCapabilityRouting(value: unknown): CapabilityRouting {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: CapabilityRouting = {};
  for (const capability of ROUTABLE_CAPABILITIES) {
    // eslint-disable-next-line security/detect-object-injection -- capability is a member of a fixed list
    const parsed = capabilityRouteSchema.safeParse((value as Record<string, unknown>)[capability]);
    // eslint-disable-next-line security/detect-object-injection -- capability is a member of a fixed list
    if (parsed.success) out[capability] = parsed.data;
  }
  return out;
}

/**
 * Applies a capability's route to an already-eligible chain: the routed provider moves to the front (with its
 * model override, if any) and the rest keep their order as fallback. A route naming a provider that is not in
 * the eligible chain is ignored, so routing can never widen where data goes.
 */
export function applyCapabilityRoute<P extends { id: string; model: string }>(
  chain: readonly P[],
  routing: CapabilityRouting | undefined,
  capability: AiCapability
): P[] {
  if (capability === 'EMBED' || !routing) return [...chain];
  const route = routing[capability as RoutableCapability];
  if (!route) return [...chain];
  const preferred = chain.find(provider => provider.id === route.providerId);
  if (!preferred) return [...chain];
  return [
    route.model ? { ...preferred, model: route.model } : preferred,
    ...chain.filter(provider => provider !== preferred),
  ];
}

/** Cheap, frequent work goes to a provider's small model; conclusions and drafts people act on to its strong one. */
export type ModelTier = 'small' | 'strong';

export const CAPABILITY_TIERS: Readonly<Record<RoutableCapability, ModelTier>> = {
  // The conversation's final answer is a synthesis over everything the turn read.
  SQUIRE_CHAT: 'strong',
  // Phrasing, briefings and summaries of earlier conversation turns.
  SUMMARIZE: 'small',
  DIAGNOSE: 'strong',
  POSTMORTEM: 'strong',
  // Classification and the investigation's tool hops.
  CLASSIFY: 'small',
};

/**
 * Each provider's small and strong chat model, from the families in the price table. Hosts that name models per
 * deployment or region (Azure OpenAI, Bedrock, Vertex, OpenAI-compatible) have no defaults: their configured
 * model is kept.
 */
export const PROVIDER_MODEL_TIERS: Readonly<
  Partial<Record<ProviderKind, Readonly<Record<ModelTier, string>>>>
> = {
  ANTHROPIC: { small: 'claude-haiku-5-5', strong: 'claude-opus-5-5' },
  OPENAI: { small: 'gpt-5-mini', strong: 'gpt-5' },
  GOOGLE: { small: 'gemini-2.5-flash', strong: 'gemini-2.5-pro' },
  MISTRAL: { small: 'mistral-small-latest', strong: 'mistral-large-latest' },
  GROQ: { small: 'llama-3.1-8b-instant', strong: 'llama-3.3-70b-versatile' },
};

/** The default model for one capability on one provider kind, or undefined to keep the configured model. */
export function defaultModelFor(
  kind: ProviderKind,
  capability: AiCapability,
  tier: ModelTier | undefined = capability === 'EMBED'
    ? undefined
    : CAPABILITY_TIERS[capability as RoutableCapability]
): string | undefined {
  // eslint-disable-next-line security/detect-object-injection -- kind and tier are members of fixed lists
  return tier ? PROVIDER_MODEL_TIERS[kind]?.[tier] : undefined;
}

/**
 * Spend controls' default routing: every provider in the chain answers this capability with its small or strong
 * model. An administrator's explicit route is applied afterwards and wins. `tier` forces one tier for every
 * capability (degradation uses `small`).
 */
export function applyDefaultTiers<P extends { kind: ProviderKind; model: string }>(
  chain: readonly P[],
  capability: AiCapability,
  tier?: ModelTier
): P[] {
  return chain.map(provider => {
    // An undefined tier falls back to the capability's own tier.
    const model = defaultModelFor(provider.kind, capability, tier);
    return model && model !== provider.model ? { ...provider, model } : provider;
  });
}

/** Input for the routing and investigation settings form. */
export const aiRoutingInputSchema = z
  .object({
    squireInvestigationEnabled: z.boolean(),
    capabilityRouting: capabilityRoutingSchema,
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();
export type AiRoutingInput = z.infer<typeof aiRoutingInputSchema>;

/**
 * Reads `route.<CAPABILITY>.provider` / `route.<CAPABILITY>.model` form fields; an empty provider means the
 * default chain. The result is validated by `aiRoutingInputSchema` before it is saved.
 */
export function routingFromForm(
  form: Pick<FormData, 'get'>
): Record<string, { providerId: string; model?: string }> {
  const text = (name: string) => {
    const value = form.get(name);
    return typeof value === 'string' ? value.trim() : '';
  };
  const routing: Record<string, { providerId: string; model?: string }> = {};
  for (const capability of ROUTABLE_CAPABILITIES) {
    const providerId = text(`route.${capability}.provider`);
    const model = text(`route.${capability}.model`);
    // eslint-disable-next-line security/detect-object-injection -- capability is a member of a fixed list
    if (providerId) routing[capability] = { providerId, ...(model ? { model } : {}) };
  }
  return routing;
}
