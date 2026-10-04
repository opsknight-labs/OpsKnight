import { performance } from 'node:perf_hooks';

/** Stop before authority expires, allowing five seconds for process-group termination. */
export class LeaseAuthority {
  private timer: NodeJS.Timeout | null = null;
  private deadline = 0;
  private disposed = false;
  constructor(
    private readonly controller: AbortController,
    private readonly marginMs = 10_000
  ) {}

  renew(expiresAt: string, hardDeadline?: string) {
    if (this.disposed || this.controller.signal.aborted) return;
    const remaining = Math.min(Date.parse(expiresAt) - Date.now(), 300_000) - this.marginMs;
    const boundedRemaining = hardDeadline
      ? Math.min(remaining, Date.parse(hardDeadline) - Date.now() - this.marginMs)
      : remaining;
    if (!Number.isFinite(boundedRemaining) || boundedRemaining <= 0) {
      this.controller.abort('LEASE_LOST');
      return;
    }
    // Use a monotonic timer so wall-clock changes cannot extend execution authority.
    this.deadline = performance.now() + boundedRemaining;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.controller.abort('LEASE_LOST'), boundedRemaining);
  }

  get valid() {
    return !this.disposed && !this.controller.signal.aborted && performance.now() < this.deadline;
  }
  dispose() {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
