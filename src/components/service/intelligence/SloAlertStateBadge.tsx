import { BellOff, BellRing, CheckCircle2, Ticket } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SloAlertState } from '@/lib/slo/burn-alerts/contract';

/** Burn-rate alert state of one objective. Text carries the meaning; colour and icon only reinforce it. */
export function SloAlertStateBadge({ state, enabled }: { state: SloAlertState; enabled: boolean }) {
  const off = !enabled && state === 'OK';
  const Icon = off
    ? BellOff
    : state === 'PAGE'
      ? BellRing
      : state === 'TICKET'
        ? Ticket
        : CheckCircle2;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
        off && 'border-border text-muted-foreground',
        !off &&
          state === 'OK' &&
          'border-status-ok-soft text-status-ok-deep dark:text-status-ok-soft',
        state === 'TICKET' &&
          'border-status-elevated-soft text-status-elevated-deep dark:text-status-elevated-soft',
        state === 'PAGE' &&
          'border-status-critical-soft text-status-critical-deep dark:text-status-critical-soft'
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {off
        ? 'Alerting off'
        : state === 'PAGE'
          ? 'Alerting: paging'
          : state === 'TICKET'
            ? 'Alerting: ticket'
            : 'Alerting: OK'}
    </span>
  );
}
