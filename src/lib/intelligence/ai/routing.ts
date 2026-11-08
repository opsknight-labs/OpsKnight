import { z } from 'zod/v4';
import type { AiCapability } from './port';

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
