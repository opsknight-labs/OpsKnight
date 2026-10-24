import { IngestionUnavailableError } from './contract';

export type QuotaDecision = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  count: number;
};
type Waiter = {
  resolve: (decision: QuotaDecision) => void;
  reject: (error: unknown) => void;
};
type State = { pending: number; groups: Map<string, Waiter[]> };
declare global {
  var opsknightIngestionQuotaBatch: State | undefined;
}

/** Coalesce concurrent decisions, never cache quota credit or mutable policy.
 * Only outstanding callers are retained, bounded across route bundles. Every
 * caller waits for the shared atomic database decision; shutdown grants nothing.
 */
export function batchQuotaDecision(
  key: string,
  decide: (count: number) => Promise<QuotaDecision[]>
): Promise<QuotaDecision> {
  const state: State = (globalThis.opsknightIngestionQuotaBatch ??= { pending: 0, groups: new Map() });
  if (state.pending >= 1024)
    return Promise.reject(new IngestionUnavailableError('Shared ingestion quota busy'));
  return new Promise((resolve, reject) => {
    let group = state.groups.get(key);
    if (!group) {
      group = [];
      state.groups.set(key, group);
      const current = group;
      setTimeout(() => {
        state.groups.delete(key);
        // Bound each statement's charge; groups may be larger when operators
        // raise the independent HTTP admission limit above its default of 32.
        for (let offset = 0; offset < current.length; offset += 32) {
          const callers = current.slice(offset, offset + 32);
          void decide(callers.length)
            .then(decisions => {
              if (decisions.length !== callers.length) throw new Error('Missing quota decisions');
              callers.forEach((caller, index) => caller.resolve(decisions.at(index)!));
            })
            .catch(error => callers.forEach(caller => caller.reject(error)))
            .finally(() => {
              state.pending -= callers.length;
            });
        }
      }, 2);
    }
    state.pending++;
    group.push({ resolve, reject });
  });
}
