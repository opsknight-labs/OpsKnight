import { McpBoundaryError, requireMcp } from './errors';
import { addOperationalMetric, setOperationalGauge } from '@/lib/metrics/operational/registry';

/**
 * The most operations one request may run. The policy field, the plan step limit and the route's
 * declared-cost check all use this value; a stored policy above it is clamped, not honoured.
 */
export const MCP_MAX_OPERATIONS = 8;

/** Concurrent bearer authentications per process before MCP_BUSY. */
export const MCP_AUTH_CONCURRENCY = 4;

export class CostBudget {
  private calls = 0;
  private bytes = 0;
  private readonly work = new Set<Promise<unknown>>();
  readonly deadline: number;
  constructor(
    readonly maxOperations = MCP_MAX_OPERATIONS,
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
  // Shed exactly like the work queue: counted in busy_total and answered with Retry-After: 1.
  if (authenticating >= MCP_AUTH_CONCURRENCY) busy();
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
// Keyed by the owning user, not the connection: parallel connections of one person share one cap.
const ownerInFlight = new Map<string, number>();
interface SlotWaiter {
  limit: number;
  ownerId?: string;
  admit: () => void;
}
const slotQueue: SlotWaiter[] = [];

/** One user may hold at most half the slots, however many connections they open. */
export const mcpGrantSlotLimit = (limit: number) => Math.max(1, Math.ceil(limit / 2));

const admissible = (limit: number, ownerId?: string) =>
  inFlight < limit &&
  (ownerId === undefined || (ownerInFlight.get(ownerId) ?? 0) < mcpGrantSlotLimit(limit));

/**
 * Work-slot usage on this process, for health checks. With the policy limit it also reports the
 * caps it is judged against; every cap is per process, so cluster capacity is cap x replicas.
 */
export function mcpSlotUsage(limit?: number) {
  const usage = { inFlight, queued: slotQueue.length };
  if (limit === undefined) return usage;
  return {
    ...usage,
    authenticating,
    limit,
    queueCap: limit * 2,
    authLimit: MCP_AUTH_CONCURRENCY,
  };
}

function publishSlotGauges() {
  setOperationalGauge('opsknight_mcp_in_flight', inFlight);
  setOperationalGauge('opsknight_mcp_queued', slotQueue.length);
}

function takeSlot(ownerId?: string) {
  inFlight++;
  if (ownerId !== undefined) ownerInFlight.set(ownerId, (ownerInFlight.get(ownerId) ?? 0) + 1);
  publishSlotGauges();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    inFlight--;
    if (ownerId !== undefined) {
      const held = (ownerInFlight.get(ownerId) ?? 1) - 1;
      if (held > 0) ownerInFlight.set(ownerId, held);
      else ownerInFlight.delete(ownerId);
    }
    // First come, first served among the waiters that can now be admitted.
    for (let index = 0; index < slotQueue.length;) {
      const waiter = slotQueue.at(index)!;
      if (admissible(waiter.limit, waiter.ownerId)) {
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
  { ownerId, waitMs = MCP_SLOT_WAIT_MS }: { ownerId?: string; waitMs?: number } = {}
): Promise<() => void> {
  setOperationalGauge('opsknight_mcp_in_flight_limit', limit);
  if (admissible(limit, ownerId)) return takeSlot(ownerId);
  if (waitMs <= 0 || slotQueue.length >= limit * 2) busy();
  return queueForSlot(limit, ownerId, waitMs);
}

/**
 * Re-admits a request that already holds a slot under a refreshed policy. The slot is kept while
 * the refreshed limits still admit it, exactly as a release and a synchronous re-take used to.
 * Releasing first would hand the slot to a queued waiter and send this request, which already
 * passed admission, to the back of the queue where it could be shed after doing half its work.
 */
export async function readmitMcpSlot(
  release: () => void,
  limit: number,
  options: { ownerId?: string; waitMs?: number } = {}
): Promise<() => void> {
  const { ownerId } = options;
  if (
    inFlight <= limit &&
    (ownerId === undefined || (ownerInFlight.get(ownerId) ?? 0) <= mcpGrantSlotLimit(limit))
  )
    return release;
  release();
  return acquireMcpSlot(limit, options);
}

function queueForSlot(limit: number, ownerId: string | undefined, waitMs: number) {
  return new Promise<() => void>((resolve, reject) => {
    const waiter: SlotWaiter = {
      limit,
      ownerId,
      admit: () => {
        clearTimeout(timer);
        resolve(takeSlot(ownerId));
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
