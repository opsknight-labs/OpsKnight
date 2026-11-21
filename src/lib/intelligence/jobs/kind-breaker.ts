/** Failures of one kind within this window are compared with its successes. */
export const KIND_BREAKER_WINDOW_MS = 5 * 60_000;
/** A tripped kind is skipped for this long; the rest of the lane keeps running. */
export const KIND_BREAKER_PAUSE_MS = 5 * 60_000;
export const KIND_BREAKER_MIN_FAILURES = 5;
export const KIND_BREAKER_FAILURE_RATIO = 0.5;

interface Sample {
  at: number;
  ok: boolean;
}

/**
 * Per-kind circuit breaker for the work queue. A handler that is failing for most of its items (a bad
 * deploy, a provider outage, a schema drift) is paused on its own for a few minutes instead of burning
 * attempts and quarantining healthy subjects, while every other kind of work continues. Pure and
 * in-memory: each lane process judges only what it has seen itself.
 */
export class KindBreaker {
  private readonly samples = new Map<string, Sample[]>();
  private readonly pausedUntil = new Map<string, number>();

  constructor(
    private readonly options = {
      windowMs: KIND_BREAKER_WINDOW_MS,
      pauseMs: KIND_BREAKER_PAUSE_MS,
      minFailures: KIND_BREAKER_MIN_FAILURES,
      failureRatio: KIND_BREAKER_FAILURE_RATIO,
    }
  ) {}

  /** Records an outcome; returns 'paused' when this failure tripped the kind. */
  record(kind: string, ok: boolean, now: number = Date.now()): 'paused' | null {
    const list = (this.samples.get(kind) ?? []).filter(s => now - s.at < this.options.windowMs);
    list.push({ at: now, ok });
    this.samples.set(kind, list);
    if (ok || this.isPaused(kind, now)) return null;
    const failures = list.filter(sample => !sample.ok).length;
    if (failures >= this.options.minFailures && failures / list.length > this.options.failureRatio) {
      this.pausedUntil.set(kind, now + this.options.pauseMs);
      this.samples.delete(kind);
      return 'paused';
    }
    return null;
  }

  isPaused(kind: string, now: number = Date.now()): boolean {
    const until = this.pausedUntil.get(kind);
    if (until === undefined) return false;
    if (until > now) return true;
    this.pausedUntil.delete(kind);
    return false;
  }

  pausedKinds(now: number = Date.now()): string[] {
    return [...this.pausedUntil.keys()].filter(kind => this.isPaused(kind, now)).sort();
  }
}
