import { ingestionConfig } from './config';
import { ingestionErrorResponse } from './http';
import { IngestionUnavailableError } from './contract';
import {
  addOperationalMetric,
  observeOperationalHistogram,
} from '@/lib/metrics/operational/registry';
import { AsyncLocalStorage } from 'node:async_hooks';

const REQUEST_WAIT_MS = 25;
type PendingRequest = {
  startedAt: number;
  timer: ReturnType<typeof setTimeout>;
  settled: boolean;
  resolve: (admitted: boolean) => void;
};
type RequestGate = { active: number; limit?: number; waiting?: PendingRequest[] };

export function ingestionBodyReadTimeoutMs(): number | undefined {
  return globalThis.opsknightIngestionRequestBodyContext?.getStore() ? 5000 : undefined;
}

declare global {
  var opsknightIngestionRequestGate: RequestGate | undefined;
  var opsknightIngestionRequestBodyContext: AsyncLocalStorage<boolean> | undefined;
}

function settleWaitingRequest(state: RequestGate, pending: PendingRequest, admitted: boolean) {
  if (pending.settled) return;
  pending.settled = true;
  clearTimeout(pending.timer);
  const index = state.waiting?.indexOf(pending) ?? -1;
  if (index >= 0) state.waiting!.splice(index, 1);
  if (admitted) state.active++;
  observeOperationalHistogram(
    'opsknight_ingestion_admission_stage_duration_ms',
    performance.now() - pending.startedAt,
    { stage: 'request-wait', outcome: admitted ? 'success' : 'failure' }
  );
  pending.resolve(admitted);
}

function drainWaitingRequests(state: RequestGate) {
  while (state.waiting?.length) {
    const pending = state.waiting[0];
    // A busy event loop may delay the timer callback. Never grant an expired
    // waiter just because its timeout has not executed yet.
    if (performance.now() - pending.startedAt >= REQUEST_WAIT_MS) {
      settleWaitingRequest(state, pending, false);
      continue;
    }
    if (state.active >= (state.limit ?? 0)) return;
    settleWaitingRequest(state, pending, true);
  }
}

function waitForRequestSlot(state: RequestGate): Promise<boolean> {
  const waiting = (state.waiting ??= []);
  // At most one unparsed waiter per active slot. Neither authentication nor
  // body reading begins while queued; parsed-payload concurrency is unchanged.
  if (waiting.length >= (state.limit ?? 0)) return Promise.resolve(false);
  return new Promise(resolve => {
    const pending: PendingRequest = {
      startedAt: performance.now(),
      settled: false,
      resolve,
      timer: setTimeout(() => {
        settleWaitingRequest(state, pending, false);
        drainWaitingRequests(state);
      }, REQUEST_WAIT_MS),
    };
    waiting.push(pending);
  });
}

/** Bound requests before authentication/body/Prisma work queues up locally.
 * Shared across route bundles in one process; this is not a distributed quota.
 * Smooth brief bursts with a bounded FIFO wait before any request work starts.
 * Never race an active operation with a timeout: it may already be committing.
 */
export async function withIngestionRequestSlot<T extends Response>(
  operation: () => Promise<T>
): Promise<T | Response> {
  const config = ingestionConfig();
  if (config.mode !== 'postgres') return operation();
  const state = (globalThis.opsknightIngestionRequestGate ??= { active: 0 });
  state.limit = config.maxInFlightRequests;
  drainWaitingRequests(state);
  if (state.active < state.limit && !state.waiting?.length) {
    state.active++;
  } else {
    const admitted = await waitForRequestSlot(state);
    if (!admitted) {
      addOperationalMetric('opsknight_ingestion_request_overload_total', 1);
      return ingestionErrorResponse(new IngestionUnavailableError('Local ingestion saturated'))!;
    }
  }
  try {
    const context = (globalThis.opsknightIngestionRequestBodyContext ??=
      new AsyncLocalStorage<boolean>());
    return await context.run(true, operation);
  } finally {
    state.active -= 1;
    drainWaitingRequests(state);
  }
}
