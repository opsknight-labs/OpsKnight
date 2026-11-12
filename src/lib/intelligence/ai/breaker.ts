export interface BreakerOptions {
  failureThreshold: number;
  openMs: number;
}

type BreakerState = { failures: number; openUntil: number; probing: boolean };

export interface SharedBreakerState {
  failures: number;
  openUntil: number;
}

/**
 * Optional shared state. Each replica still decides locally and keeps working if the store fails; the store
 * only lets a replica learn that another one has already found a provider broken, so a bad endpoint is
 * probed once per cluster instead of once per process.
 */
export interface SharedBreakerStore {
  load(id: string): Promise<SharedBreakerState | null>;
  save(id: string, state: SharedBreakerState): Promise<void>;
}

/** How long a loaded shared reading is trusted before it is read again. */
export const SHARED_BREAKER_REFRESH_MS = 5_000;

/**
 * Per-provider circuit breaker. After `failureThreshold` consecutive failures the provider is skipped
 * for `openMs`, then a single probe is let through; success closes it, failure re-opens it. State is
 * local to the process by default, which is deliberate: each replica learns about a bad endpoint
 * independently and there is no shared dependency to fail. A shared store, when configured, is read
 * best-effort before choosing providers and written best-effort after each outcome.
 */
export class ProviderBreakers {
  private readonly states = new Map<string, BreakerState>();
  private readonly refreshedAt = new Map<string, number>();

  constructor(
    private readonly options: BreakerOptions = { failureThreshold: 3, openMs: 30_000 },
    private readonly now: () => number = Date.now,
    private store: SharedBreakerStore | null = null
  ) {}

  /** Installs or replaces the shared store (used once at gateway registration). */
  useStore(store: SharedBreakerStore | null): void {
    this.store = store;
    this.refreshedAt.clear();
  }

  private state(id: string): BreakerState {
    let state = this.states.get(id);
    if (!state) {
      state = { failures: 0, openUntil: 0, probing: false };
      this.states.set(id, state);
    }
    return state;
  }

  /**
   * Adopts a more pessimistic reading from the shared store, at most once per refresh interval per provider.
   * Never throws and never waits on a failing store longer than the store itself allows.
   */
  async sync(ids: readonly string[]): Promise<void> {
    if (!this.store) return;
    const due = ids.filter(id => {
      const last = this.refreshedAt.get(id);
      return last === undefined || this.now() - last >= SHARED_BREAKER_REFRESH_MS;
    });
    if (due.length === 0) return;
    for (const id of due) this.refreshedAt.set(id, this.now());
    await Promise.all(
      due.map(async id => {
        try {
          const shared = await this.store!.load(id);
          if (!shared) return;
          const state = this.state(id);
          if (shared.openUntil > state.openUntil && shared.openUntil > this.now()) {
            state.openUntil = shared.openUntil;
            state.failures = Math.max(
              state.failures,
              shared.failures,
              this.options.failureThreshold
            );
          }
        } catch {
          /* The local reading stands. */
        }
      })
    );
  }

  private publish(id: string): void {
    if (!this.store) return;
    const state = this.state(id);
    void this.store
      .save(id, { failures: state.failures, openUntil: state.openUntil })
      .catch(() => {});
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
    this.publish(id);
  }

  recordFailure(id: string): void {
    const state = this.state(id);
    state.failures += 1;
    state.probing = false;
    if (state.failures >= this.options.failureThreshold)
      state.openUntil = this.now() + this.options.openMs;
    this.publish(id);
  }

  isOpen(id: string): boolean {
    const state = this.state(id);
    return state.failures >= this.options.failureThreshold && this.now() < state.openUntil;
  }
}
