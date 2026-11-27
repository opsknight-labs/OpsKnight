'use client';

import type { IncidentSlaState } from '@/lib/incident-sla/state';
import { AlertCircle, AlertTriangle, CheckCircle2, Pause, Timer } from 'lucide-react';
import { toneClasses, type ToneKey } from '@/components/patterns/status-tone';
import { formatTimeMinutesMs } from '@/lib/time-format';
import { useState } from 'react';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/shadcn/hover-card';
import { cn } from '@/lib/utils';
import SLAIndicator from '../SLAIndicator';

type IncidentSLABadgesProps = {
  sla: IncidentSlaState | null;
  className?: string;
  /** Phones: shorter chip text ("Ack +1d 13h"); the card has the full numbers. */
  compact?: boolean;
};

type Phase = Extract<IncidentSlaState, { valid: true }>['ack'];

/** Plain-language state for one SLA phase: what happened, how far over/under, and the tone. */
/** Resolved before anyone acknowledged it: breached by policy, though no time is overdue. */
const closedUnacknowledged = (phase: Phase) =>
  phase.status === 'BREACHED' && phase.completedAt === null && phase.elapsedMs <= phase.targetMs;

function describePhase(phase: Phase) {
  const target = formatTimeMinutesMs(phase.targetMs);
  switch (phase.status) {
    case 'MET':
      return {
        tone: 'ok' as ToneKey,
        icon: CheckCircle2,
        state: `Met in ${formatTimeMinutesMs(phase.elapsedMs)}`,
        target,
      };
    case 'BREACHED':
      return {
        tone: 'critical' as ToneKey,
        icon: AlertCircle,
        state: closedUnacknowledged(phase)
          ? 'Resolved without acknowledgement'
          : `${formatTimeMinutesMs(phase.elapsedMs - phase.targetMs)} overdue`,
        target,
      };
    case 'NOT_REQUIRED':
      return { tone: 'neutral' as ToneKey, icon: Timer, state: 'Not required', target: null };
    default:
      return {
        tone: (phase.warning === 'APPROACHING' ? 'elevated' : 'neutral') as ToneKey,
        icon: phase.warning === 'APPROACHING' ? AlertTriangle : Timer,
        state: `${formatTimeMinutesMs(phase.remainingMs)} left`,
        target,
      };
  }
}

/** Two largest units only: "1d 13h", "2h 5m", "12m". */
function shortDuration(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days) return `${days}d${hours ? ` ${hours}h` : ''}`;
  if (hours) return `${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ''}`;
  return `${minutes}m`;
}

/** Short chip text for phones: "+1d 13h" over, "12m left", "met". */
function shortState(phase: Phase): string {
  switch (phase.status) {
    case 'MET':
      return 'met';
    case 'BREACHED':
      return closedUnacknowledged(phase)
        ? 'Not acked'
        : `+${shortDuration(phase.elapsedMs - phase.targetMs)}`;
    case 'NOT_REQUIRED':
      return 'n/a';
    default:
      return `${shortDuration(phase.remainingMs)} left`;
  }
}

export default function IncidentSLABadges({
  sla,
  className,
  compact = false,
}: IncidentSLABadgesProps) {
  // Controlled so a tap opens the details on touch screens too.
  const [open, setOpen] = useState(false);
  return (
    <div className={cn('flex flex-wrap items-center gap-x-2 gap-y-1.5 pt-1.5', className)}>
      {/* Same quiet label style as "Impacts" beside it, so the chips carry the signal. */}
      <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex">
        <Timer className="h-3.5 w-3.5 shrink-0" aria-hidden />
        SLA
      </span>
      {!sla || !sla.valid ? (
        <SLAIndicator sla={sla} />
      ) : (
        <HoverCard open={open} onOpenChange={setOpen} openDelay={200} closeDelay={100}>
          <HoverCardTrigger asChild>
            <ul
              className="flex cursor-default flex-wrap items-center gap-1.5"
              aria-label="SLA status"
              tabIndex={0}
              onClick={() => setOpen(value => !value)}
            >
              {sla.clock.paused && (
                <li
                  className={cn(
                    'inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold shadow-2xs',
                    toneClasses('elevated').soft
                  )}
                >
                  <Pause className="h-3.5 w-3.5" aria-hidden />
                  Clock paused
                </li>
              )}
              {[
                { name: 'Ack', full: 'Acknowledge', phase: sla.ack },
                { name: 'Resolve', full: 'Resolve', phase: sla.resolve },
              ].map(({ name, full, phase }) => {
                const view = describePhase(phase);
                const Icon = view.icon;
                const tone = toneClasses(view.tone);
                const used = Math.min(Math.max(phase.progress, 0), 1);
                return (
                  <li
                    key={name}
                    title={
                      view.target
                        ? `${full}: ${formatTimeMinutesMs(phase.elapsedMs)} elapsed of a ${view.target} target`
                        : `${full}: not required`
                    }
                    className={cn(
                      'relative inline-flex h-8 items-center gap-1.5 overflow-hidden rounded-md border px-2.5 text-xs shadow-2xs tabular-nums',
                      tone.soft
                    )}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span className="font-semibold">{name}</span>
                    <span className="font-medium">
                      · {compact ? shortState(phase) : view.state}
                    </span>
                    {view.target && !compact && (
                      <span className="hidden opacity-70 sm:inline">/ {view.target}</span>
                    )}
                    {/* Time used against the target, as a hairline along the bottom edge. */}
                    {phase.status !== 'NOT_REQUIRED' && phase.status !== 'MET' && (
                      <span
                        aria-hidden
                        className={cn('absolute bottom-0 left-0 h-0.5 opacity-70', tone.solid)}
                        style={{ width: `${used * 100}%` }}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </HoverCardTrigger>
          <HoverCardContent align="start" className="w-80 space-y-2.5 p-3">
            <p className="text-xs font-semibold text-foreground">Response targets</p>
            {[
              { full: 'Acknowledge', phase: sla.ack },
              { full: 'Resolve', phase: sla.resolve },
            ].map(({ full, phase }) => {
              const view = describePhase(phase);
              return (
                <div key={full} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="font-medium text-foreground">{full}</span>
                    <span className={cn('font-semibold tabular-nums', toneClasses(view.tone).text)}>
                      {view.state}
                    </span>
                  </div>
                  {view.target && (
                    <div className="flex justify-between text-2xs tabular-nums text-muted-foreground">
                      <span>Elapsed {formatTimeMinutesMs(phase.elapsedMs)}</span>
                      <span>Target {view.target}</span>
                    </div>
                  )}
                </div>
              );
            })}
            <p className="border-t border-border pt-2 text-2xs text-muted-foreground">
              Contract: {sla.contract.priorityAtCapture ?? 'Fallback'} · policy v
              {sla.contract.policyVersion ?? 'legacy'} · {sla.contract.policyRule ?? 'base'}
              {sla.clock.pausedMs >= 60_000 &&
                ` · paused ${formatTimeMinutesMs(sla.clock.pausedMs)} in total`}
            </p>
          </HoverCardContent>
        </HoverCard>
      )}
      {/* Paused time already discounted from the targets (on the SLA state, no extra read). */}
      {sla?.valid && sla.clock.pausedMs >= 60_000 && !sla.clock.paused && (
        <span
          className="text-2xs text-muted-foreground"
          title="Time the SLA clock was paused (snoozed, suppressed or in maintenance); not counted against the targets"
        >
          paused {formatTimeMinutesMs(sla.clock.pausedMs)} in total
        </span>
      )}
    </div>
  );
}
