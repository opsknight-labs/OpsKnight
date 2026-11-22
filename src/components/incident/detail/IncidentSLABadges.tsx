'use client';

import type { IncidentSlaState } from '@/lib/incident-sla/state';
import { AlertCircle, AlertTriangle, CheckCircle2, Pause, Timer } from 'lucide-react';
import { toneClasses, type ToneKey } from '@/components/patterns/status-tone';
import { formatTimeMinutesMs } from '@/lib/time-format';
import { cn } from '@/lib/utils';
import SLAIndicator from '../SLAIndicator';

type IncidentSLABadgesProps = {
  sla: IncidentSlaState | null;
  className?: string;
};

type Phase = Extract<IncidentSlaState, { valid: true }>['ack'];

/** Plain-language state for one SLA phase: what happened, how far over/under, and the tone. */
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
        state: `${formatTimeMinutesMs(Math.max(0, phase.elapsedMs - phase.targetMs))} overdue`,
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

export default function IncidentSLABadges({ sla, className }: IncidentSLABadgesProps) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-2 gap-y-1.5 pt-1.5', className)}>
      {/* Same quiet label style as "Impacts" beside it, so the chips carry the signal. */}
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Timer className="h-3.5 w-3.5 shrink-0" aria-hidden />
        SLA
      </span>
      {!sla || !sla.valid ? (
        <SLAIndicator sla={sla} />
      ) : (
        <ul className="flex flex-wrap items-center gap-1.5" aria-label="SLA status">
          {sla.clock.paused && (
            <li
              className={cn(
                'inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold',
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
                  'relative inline-flex h-7 items-center gap-1.5 overflow-hidden rounded-lg border px-2.5 text-xs tabular-nums',
                  tone.soft
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="font-semibold">{name}</span>
                <span className="font-medium">· {view.state}</span>
                {view.target && (
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
      )}
    </div>
  );
}
