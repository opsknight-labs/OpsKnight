export interface BreakerOptions {
  failureThreshold: number;
  openMs: number;
}

type BreakerState = { failures: number; openUntil: number; probing: boolean };

/**
 * Per-provider circuit breaker. After `failureThreshold` consecutive failures the provider is skipped
 * for `openMs`, then a single probe is let through; success closes it, failure re-opens it. State is
 * local to the process, which is deliberate: each replica learns about a bad endpoint independently
 * and there is no shared dependency to fail.
 */
export class ProviderBreakers {
  private readonly states = new Map<string, BreakerState>();

  constructor(
    private readonly options: BreakerOptions = { failureThreshold: 3, openMs: 30_000 },
    private readonly now: () => number = Date.now
  ) {}

  private state(id: string): BreakerState {
    let state = this.states.get(id);
    if (!state) {
      state = { failures: 0, openUntil: 0, probing: false };
      this.states.set(id, state);
    }
    return state;
  }

  /**
   * Side-effect free: true when a call could go to this provider now (closed, or open long enough for its
   * probe and no probe in flight). Use it to choose providers; only `canAttempt` takes the probe.
   */
  available(id: string): boolean {
    const state = this.state(id);
    if (state.failures < this.options.failureThreshold) return true;
    return this.now() >= state.openUntil && !state.probing;
  }

  /**
   * Call immediately before contacting the provider. True when the call may proceed; half-open admits
   * exactly one probe at a time, and that probe must end in recordSuccess, recordFailure or release.
   */
  canAttempt(id: string): boolean {
    const state = this.state(id);
    if (state.failures < this.options.failureThreshold) return true;
    if (this.now() < state.openUntil) return false;
    if (state.probing) return false;
    state.probing = true;
    return true;
  }

  /** Ends a call that says nothing about the provider's health (the caller cancelled), freeing its probe. */
  release(id: string): void {
    this.state(id).probing = false;
  }

  recordSuccess(id: string): void {
    this.states.set(id, { failures: 0, openUntil: 0, probing: false });
  }

  recordFailure(id: string): void {
    const state = this.state(id);
    state.failures += 1;
    state.probing = false;
    if (state.failures >= this.options.failureThreshold)
      state.openUntil = this.now() + this.options.openMs;
  }

  isOpen(id: string): boolean {
    const state = this.state(id);
    return state.failures >= this.options.failureThreshold && this.now() < state.openUntil;
  }
}
