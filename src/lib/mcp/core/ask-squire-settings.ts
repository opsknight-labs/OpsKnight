import 'server-only';
import { getAiSettings } from '@/lib/intelligence/ai/settings';

/**
 * Listing the tool reads the switch on every MCP request, so the answer is cached briefly per process;
 * a call to the tool always reads it fresh, so turning it off takes effect at once for calls.
 */
const LIST_CACHE_MS = 15_000;
let cached: { value: boolean; at: number } | null = null;

/** Whether ask_squire is offered: the assistant and its MCP surface are both on. Fails closed. */
export async function isAskSquireEnabled(options: { fresh?: boolean } = {}): Promise<boolean> {
  if (!options.fresh && cached && Date.now() - cached.at < LIST_CACHE_MS) return cached.value;
  try {
    const settings = await getAiSettings();
    const value = settings.squireEnabled && settings.squireMcpEnabled;
    cached = { value, at: Date.now() };
    return value;
  } catch {
    return false;
  }
}

/** Tests and the settings page drop the cached answer. */
export function resetAskSquireEnabledCache() {
  cached = null;
}
