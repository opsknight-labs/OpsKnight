import { createHash } from 'node:crypto';

/** Canonical JSON hashing: object insertion order never changes the identity of analysis inputs. */
export function stableAnalysisHash(input: unknown): string {
  function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, canonical(item)])
      );
    }
    return value;
  }
  return createHash('sha256')
    .update(JSON.stringify(canonical(input)))
    .digest('hex');
}
