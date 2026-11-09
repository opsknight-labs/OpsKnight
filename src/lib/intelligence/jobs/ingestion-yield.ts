import {
  averageInFlight,
  snapshotIngestionActivity,
  type IngestionActivitySnapshot,
} from '@/lib/ingestion/activity';

/**
 * Lets the lane back off while ingestion in the same process is busy. Analysis shares the event loop, the
 * Prisma engine and PostgreSQL with `processEvent`; measured in the ingestion A/B benchmark, a lane running
 * at full speed beside a burst slowed every ingestion statement (see
 * plans/intelligence-engine/certification/perf/ingestion-p50-diagnosis-2026-11-09.md).
 *
 * The signal is the average number of `processEvent` calls in flight, measured over at least `sampleMs`.
 * The lane starts yielding when it reaches `enterLoad` and stops only after it has stayed below `exitLoad`
 * for `holdMs` (hysteresis, so it does not flap at the edge of a burst). While yielding, the lane runs one
 * item at a time and, after each cycle, pauses so that it is active for at most `duty` of wall time. It
 * never stops: a lane under constant ingestion still makes progress. In the dedicated
 * `intelligence-worker` role nothing is ingested in-process, so the lane never yields there.
 */
export interface IngestionYieldOptions {
  enterLoad: number;
  exitLoad: number;
  holdMs: number;
  duty: number;
  maxPauseMs: number;
  pollMs: number;
  sampleMs: number;
}

export const INGESTION_YIELD_DEFAULTS: IngestionYieldOptions = {
  enterLoad: 1,
  exitLoad: 0.25,
  holdMs: 1_000,
  duty: 0.2,
  maxPauseMs: 1_000,
  pollMs: 25,
  sampleMs: 50,
};

type Sleep = (ms: number) => Promise<void>;

const defaultSleep: Sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export class IngestionYield {
  private last: IngestionActivitySnapshot;
  private yielding = false;
  private quietSince: number | null = null;
  private lastLoad = 0;
  private pausedTotalMs = 0;
  private readonly options: IngestionYieldOptions;

  constructor(
    private readonly source: () => IngestionActivitySnapshot = () => snapshotIngestionActivity(),
    options: Partial<IngestionYieldOptions> = {},
    private readonly sleep: Sleep = defaultSleep
  ) {
    this.options = { ...INGESTION_YIELD_DEFAULTS, ...options };
    this.last = source();
  }

  /** Total time spent in `pause`, so callers can tell their own work time from time spent yielding. */
  get pausedMs(): number {
    return this.pausedTotalMs;
  }

  /** The most recent measured load (average events in flight). */
  get load(): number {
    return this.lastLoad;
  }

  /** Re-measures the load once at least `sampleMs` has passed and applies the hysteresis. */
  isYielding(): boolean {
    const now = this.source();
    if (now.at - this.last.at < this.options.sampleMs) return this.yielding;
    const load = averageInFlight(this.last, now);
    this.last = now;
    this.lastLoad = load;
    if (!this.yielding) {
      if (load >= this.options.enterLoad) {
        this.yielding = true;
        this.quietSince = null;
      }
      return this.yielding;
    }
    if (load >= this.options.exitLoad) {
      this.quietSince = null;
    } else {
      this.quietSince ??= now.at;
      if (now.at - this.quietSince >= this.options.holdMs) {
        this.yielding = false;
        this.quietSince = null;
      }
    }
    return this.yielding;
  }

  /**
   * After `workMs` of lane work, waits long enough to keep the lane's share of wall time at `duty`, capped
   * at `maxPauseMs`. Returns early once ingestion goes quiet or `signal` aborts. Nothing is held while
   * waiting: no claimed item, transaction or connection. Returns how long it waited.
   */
  async pause(workMs: number, signal?: AbortSignal): Promise<number> {
    if (!this.isYielding()) return 0;
    const { duty, maxPauseMs, pollMs } = this.options;
    const target = Math.min(maxPauseMs, Math.max(0, workMs) * ((1 - duty) / duty));
    let waited = 0;
    while (waited < target && !signal?.aborted) {
      const step = Math.min(pollMs, target - waited);
      await this.sleep(step);
      waited += step;
      if (!this.isYielding()) break;
    }
    this.pausedTotalMs += waited;
    return waited;
  }
}
