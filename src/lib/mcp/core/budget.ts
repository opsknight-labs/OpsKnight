import { requireMcp } from './errors';

export class CostBudget {
  private calls = 0;
  private bytes = 0;
  private readonly work = new Set<Promise<unknown>>();
  readonly deadline: number;
  constructor(
    readonly maxOperations = 8,
    readonly maxBytes = 262144,
    readonly signal?: AbortSignal,
    timeoutMs = 10000
  ) {
    this.deadline = Date.now() + timeoutMs;
  }
  check() {
    requireMcp(!this.signal?.aborted, 'MCP_CANCELLED', 408);
    requireMcp(Date.now() < this.deadline, 'MCP_DEADLINE_EXCEEDED', 408);
  }
  consumeOperation() {
    this.check();
    requireMcp(++this.calls <= this.maxOperations, 'MCP_OPERATION_BUDGET_EXCEEDED', 429);
  }
  consumeResult(value: unknown) {
    this.check();
    this.bytes += Buffer.byteLength(JSON.stringify(value));
    requireMcp(this.bytes <= this.maxBytes, 'MCP_RESULT_BUDGET_EXCEEDED', 413);
  }
  track<T>(promise: Promise<T>): Promise<T> {
    this.work.add(promise);
    // Attach both handlers without creating an unobserved rejected finally-promise.
    void promise.then(
      () => this.work.delete(promise),
      () => this.work.delete(promise)
    );
    return promise;
  }
  async drain() {
    while (this.work.size) await Promise.allSettled([...this.work]);
  }
}

let inFlight = 0;
let authenticating = 0;
export function acquireMcpAuthenticationSlot() {
  requireMcp(authenticating < 4, 'MCP_BUSY', 503);
  authenticating++;
  let released = false;
  return () => {
    if (!released) {
      released = true;
      authenticating--;
    }
  };
}
// A load-shedding semaphore, never an authorization or shared-quota counter.
export function acquireMcpSlot(limit: number) {
  requireMcp(inFlight < limit, 'MCP_BUSY', 503);
  inFlight++;
  let released = false;
  return () => {
    if (!released) {
      released = true;
      inFlight--;
    }
  };
}
