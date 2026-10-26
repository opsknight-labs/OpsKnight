import { IngestionUnavailableError } from './contract';

export type QuotaDecision = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  count: number;
};
type Decide = (keys: readonly string[]) => Promise<QuotaDecision[]>;
type Waiter = {
  key: string;
  decide: Decide;
  resolve: (decision: QuotaDecision) => void;
  reject: (error: unknown) => void;
};
type State = { pending: number; active: number; queued: Waiter[]; timer: ReturnType<typeof setTimeout> | null };
declare global {
  var opsknightIngestionQuotaBatchV2: State | undefined;
}

/** Coalesce outstanding requests across keys, never cache quota credit or policy.
 * Each batch charges at most32 callers; at most two database decisions run at
 * once. Every caller awaits its atomic database result. Failed batches grant
 * nothing and release their local capacity, including synchronous failures.
 */
export function batchQuotaDecision(key: string, decide: Decide): Promise<QuotaDecision> {
  const state: State = (globalThis.opsknightIngestionQuotaBatchV2 ??= {
    pending: 0, active: 0, queued: [], timer: null,
  });
  if (state.pending >= 1024)
    return Promise.reject(new IngestionUnavailableError('Shared ingestion quota busy'));
  const flush = () => {
    while (state.active < 2 && state.queued.length) {
      const callers = state.queued.splice(0, 32);
      state.active++;
      void Promise.resolve()
        .then(() => callers[0].decide(callers.map(caller => caller.key)))
        .then(decisions => {
          if (decisions.length !== callers.length) throw new Error('Missing quota decisions');
          callers.forEach((caller, index) => caller.resolve(decisions.at(index)!));
        })
        .catch(error => callers.forEach(caller => caller.reject(error)))
        .finally(() => {
          state.pending -= callers.length;
          state.active--;
          flush();
        });
    }
  };
  return new Promise((resolve, reject) => {
    state.pending++;
    state.queued.push({ key, decide, resolve, reject });
    if (state.active < 2 && !state.timer) {
      state.timer = setTimeout(() => {
        state.timer = null;
        flush();
      }, 2);
    }
  });
}
