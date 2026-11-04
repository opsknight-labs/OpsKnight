import { McpBoundaryError, requireMcp } from './errors';
import { addOperationalMetric, setOperationalGauge } from '@/lib/metrics/operational/registry';

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

/** How long a request waits for a work slot before MCP_BUSY; parallel tool calls are routine. */
export const MCP_SLOT_WAIT_MS = 750;
const grantInFlight = new Map<string, number>();
interface SlotWaiter {
  limit: number;
  grantId?: string;
  admit: () => void;
}
const slotQueue: SlotWaiter[] = [];

/** One connection may hold at most half the slots, so it cannot starve everyone else. */
export const mcpGrantSlotLimit = (limit: number) => Math.max(1, Math.ceil(limit / 2));

const admissible = (limit: number, grantId?: string) =>
  inFlight < limit &&
  (grantId === undefined || (grantInFlight.get(grantId) ?? 0) < mcpGrantSlotLimit(limit));

/** Work-slot usage on this process, for health checks. */
export function mcpSlotUsage() {
  return { inFlight, queued: slotQueue.length };
}

function publishSlotGauges() {
  setOperationalGauge('opsknight_mcp_in_flight', inFlight);
  setOperationalGauge('opsknight_mcp_queued', slotQueue.length);
}

function takeSlot(grantId?: string) {
  inFlight++;
  if (grantId !== undefined) grantInFlight.set(grantId, (grantInFlight.get(grantId) ?? 0) + 1);
  publishSlotGauges();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    inFlight--;
    if (grantId !== undefined) {
      const held = (grantInFlight.get(grantId) ?? 1) - 1;
      if (held > 0) grantInFlight.set(grantId, held);
      else grantInFlight.delete(grantId);
    }
    // First come, first served among the waiters that can now be admitted.
    for (let index = 0; index < slotQueue.length;) {
      const waiter = slotQueue.at(index)!;
      if (admissible(waiter.limit, waiter.grantId)) {
        slotQueue.splice(index, 1);
        waiter.admit();
      } else index++;
    }
    publishSlotGauges();
  };
}

function busy(): never {
  addOperationalMetric('opsknight_mcp_busy_total', 1);
  throw new McpBoundaryError('MCP_BUSY', 503, true, undefined, { retryAfterSeconds: 1 });
}

/**
 * A load-shedding semaphore, never an authorization or shared-quota counter. A request that finds
 * no free slot waits briefly in a bounded first-come queue (at most twice the limit) and is shed
 * with a retryable MCP_BUSY only when none frees up in time.
 */
export async function acquireMcpSlot(
  limit: number,
  { grantId, waitMs = MCP_SLOT_WAIT_MS }: { grantId?: string; waitMs?: number } = {}
): Promise<() => void> {
  if (admissible(limit, grantId)) return takeSlot(grantId);
  if (waitMs <= 0 || slotQueue.length >= limit * 2) busy();
  return new Promise<() => void>((resolve, reject) => {
    const waiter: SlotWaiter = {
      limit,
      grantId,
      admit: () => {
        clearTimeout(timer);
        resolve(takeSlot(grantId));
      },
    };
    const timer = setTimeout(() => {
      const index = slotQueue.indexOf(waiter);
      if (index >= 0) slotQueue.splice(index, 1);
      publishSlotGauges();
      try {
        busy();
      } catch (error) {
        reject(error);
      }
    }, waitMs);
    slotQueue.push(waiter);
    publishSlotGauges();
  });
}
