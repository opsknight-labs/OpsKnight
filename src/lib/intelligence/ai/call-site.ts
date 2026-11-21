import { AsyncLocalStorage } from 'node:async_hooks';
import { AI_CALL_SITES, type AiCallSite } from './port';

/**
 * Deterministic-first gate. A loader that feeds a list view or a badge runs inside `deterministicOnly`; the
 * gateway refuses any model call made in that zone, whatever its tag, so a list page can never spend tokens.
 */
const zone = new AsyncLocalStorage<string>();

export function deterministicOnly<T>(surface: string, run: () => T): T {
  return zone.run(surface, run);
}

/** The list/badge surface being rendered, or null outside one. */
export const deterministicSurface = (): string | null => zone.getStore() ?? null;

export const isAiCallSite = (value: unknown): value is AiCallSite =>
  (AI_CALL_SITES as readonly unknown[]).includes(value);

/** Why a model call must be refused, or null when it may proceed. */
export function callSiteRefusal(context: { callSite?: unknown }): string | null {
  if (!isAiCallSite(context.callSite)) return 'AI call without a call-site tag';
  const surface = deterministicSurface();
  return surface ? `AI calls are not allowed while rendering ${surface}` : null;
}
