import { dataClassAllows, type AiDataClass } from './port';

export interface PolicyProvider {
  id: string;
  enabled: boolean;
  isExternal: boolean;
  maxDataClass: AiDataClass;
  priority: number;
}

/**
 * Ordered providers allowed to receive a request of `dataClass`.
 *
 * The first entry is the primary; the rest are fallbacks. A fallback is only eligible when it cannot
 * widen where the data goes: an external provider may back up another external provider, but a
 * self-hosted primary never falls back to an external one unless an administrator has explicitly
 * allowed that. Anything whose ceiling is below the request's data class is excluded entirely, so a
 * fallback can never receive data its own policy forbids.
 */
export function selectProviderChain<T extends PolicyProvider>(
  providers: readonly T[],
  dataClass: AiDataClass,
  options: { allowExternalFallback: boolean }
): T[] {
  const eligible = providers
    .filter(provider => provider.enabled && dataClassAllows(provider.maxDataClass, dataClass))
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  const [primary, ...rest] = eligible;
  if (!primary) return [];
  const fallbacks = rest.filter(
    candidate => !candidate.isExternal || primary.isExternal || options.allowExternalFallback
  );
  return [primary, ...fallbacks];
}

/** True when any enabled provider could ever receive requests of this class. */
export function anyProviderAllows(providers: readonly PolicyProvider[], dataClass: AiDataClass): boolean {
  return providers.some(provider => provider.enabled && dataClassAllows(provider.maxDataClass, dataClass));
}
