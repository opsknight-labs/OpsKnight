/**
 * Offline estimate of provider prompt-cache reads, from the request bodies a conversation sent (OpenAI-style
 * `{ tools, messages }`, as the scripted eval model records them). It mirrors the gateway's Anthropic/Bedrock
 * markers: the system prompt carries one and the newest message of every step carries the rolling one
 * (`withRollingCacheBreakpoint`), so a request can read from cache the longest prefix it shares with the
 * previous request — the same tool catalogue, then the same leading messages. Anything shorter than the
 * provider's minimum cacheable prefix is never cached.
 */

/** Anthropic's smallest cacheable prefix for Sonnet/Opus class models; Haiku needs 2048. */
export const MIN_CACHEABLE_PREFIX_TOKENS = 1024;

/** Same rough estimate the budget uses (`estimateTokens` in budget.ts), kept here so this stays dependency-free. */
const tokens = (value: unknown) => Math.ceil(JSON.stringify(value ?? null).length / 4);

export interface CacheEstimate {
  /** Estimated prompt tokens of every request. */
  inputTokens: number;
  /** Of those, tokens inside a prefix the previous request already wrote to cache. */
  cacheReadTokens: number;
  /** Cache-readable prefix per request, in order (0 for a cold request). */
  perStep: number[];
}

interface RequestBody {
  tools?: unknown;
  messages?: unknown[];
}

export function estimateCacheReads(requests: readonly unknown[]): CacheEstimate {
  let inputTokens = 0;
  let cacheReadTokens = 0;
  const perStep: number[] = [];
  let previous: RequestBody | undefined;
  for (const raw of requests) {
    const body = raw as RequestBody;
    const messages = body.messages ?? [];
    const toolTokens = tokens(body.tools ?? []);
    inputTokens += toolTokens + messages.reduce<number>((sum, m) => sum + tokens(m), 0);
    let prefix = 0;
    // Tools come first in the provider's prompt, so a different catalogue invalidates everything after it.
    if (previous && JSON.stringify(previous.tools ?? []) === JSON.stringify(body.tools ?? [])) {
      const before = previous.messages ?? [];
      prefix = toolTokens;
      for (let i = 0; i < Math.min(before.length, messages.length); i += 1) {
        // eslint-disable-next-line security/detect-object-injection -- i is a bounded array index
        if (JSON.stringify(before[i]) !== JSON.stringify(messages[i])) break;
        // eslint-disable-next-line security/detect-object-injection -- i is a bounded array index
        prefix += tokens(messages[i]);
      }
      if (prefix < MIN_CACHEABLE_PREFIX_TOKENS) prefix = 0;
    }
    perStep.push(prefix);
    cacheReadTokens += prefix;
    previous = body;
  }
  return { inputTokens, cacheReadTokens, perStep };
}
