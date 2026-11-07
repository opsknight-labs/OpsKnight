/**
 * Small in-process caches for basic mode. Answers are cached for a few seconds per person and question, so a
 * chip pressed twice or a quick re-ask does not re-run the same scoped reads; time zones are cached for a
 * minute. Entries are keyed by the actor, so one person's cached answer can never be served to another.
 */

interface Entry<T> {
  value: T;
  expiresAt: number;
}

export class TtlCache<T> {
  private readonly entries = new Map<string, Entry<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 500,
    private readonly now: () => number = Date.now
  ) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    if (this.entries.size >= this.maxEntries) {
      // Drop the oldest insertion; Map iteration order is insertion order.
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

export const BASIC_ANSWER_TTL_MS = 10_000;
export const TIMEZONE_TTL_MS = 60_000;
export const ENTITY_TTL_MS = 60_000;
