'use client';

import { useState } from 'react';
import InFlightEscalationConfirm, { type InFlightStepChange } from './InFlightEscalationConfirm';

type Pending = {
  count: number;
  change: InFlightStepChange;
  run: () => void;
  onCancel?: () => void;
};

/**
 * Runs a step move or reorder straight away when no incident is mid-escalation on the
 * policy, and after the operator confirms when some are. Render `dialog` beside the caller.
 */
export function useInFlightEscalationGuard(countInFlight: () => Promise<number>) {
  const [pending, setPending] = useState<Pending | null>(null);

  async function guard(change: InFlightStepChange, run: () => void, onCancel?: () => void) {
    const count = await countInFlight();
    if (count > 0) setPending({ count, change, run, onCancel });
    else run();
  }

  const dialog = pending ? (
    <InFlightEscalationConfirm
      count={pending.count}
      change={pending.change}
      onConfirm={() => {
        setPending(null);
        pending.run();
      }}
      onCancel={() => {
        setPending(null);
        pending.onCancel?.();
      }}
    />
  ) : null;

  return { guard, dialog };
}
