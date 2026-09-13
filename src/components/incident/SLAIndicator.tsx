'use client';

import type { IncidentSlaState } from '@/lib/incident-sla/state';
import { formatTimeMinutesMs } from '@/lib/time-format';
import { CheckCircle2, AlertCircle, AlertTriangle, Timer, Pause, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/shadcn/badge';
import { cn } from '@/lib/utils';

type SLAIndicatorProps = {
  sla: IncidentSlaState | null;
  showDetails?: boolean;
  className?: string;
};

type Phase = Extract<IncidentSlaState, { valid: true }>['ack'];

function getPhaseBadgeConfig(phase: Phase) {
  switch (phase.status) {
    case 'MET':
      return {
        variant: 'success' as const,
        label: 'Met',
        barColor: 'bg-emerald-500',
        icon: CheckCircle2,
      };
    case 'BREACHED':
      return {
        variant: 'danger' as const,
        label: 'Breached',
        barColor: 'bg-rose-500',
        icon: AlertCircle,
      };
    case 'NOT_REQUIRED':
      return {
        variant: 'outline' as const,
        label: 'Not required',
        barColor: 'bg-muted-foreground',
        icon: Timer,
      };
    default:
      if (phase.warning === 'APPROACHING') {
        return {
          variant: 'warning' as const,
          label: `${formatTimeMinutesMs(phase.remainingMs)} left`,
          barColor: 'bg-amber-500',
          icon: AlertTriangle,
        };
      }
      return {
        variant: 'info' as const,
        label: `${formatTimeMinutesMs(phase.remainingMs)} left`,
        barColor: 'bg-blue-500',
        icon: Timer,
      };
  }
}

/** Presentation only; decisions and measurements belong to the shared projector. */
export default function SLAIndicator({ sla, showDetails = false, className }: SLAIndicatorProps) {
  if (!sla) {
    return (
      <span
        className={cn('inline-flex items-center gap-1.5 text-xs text-muted-foreground', className)}
      >
        <Clock className="h-3.5 w-3.5 animate-spin opacity-70" />
        <span>Evaluating SLA…</span>
      </span>
    );
  }

  if (!sla.valid) {
    return (
      <Badge variant="danger" size="xs" className={cn('gap-1', className)} title={sla.reason}>
        <AlertCircle className="h-3 w-3 shrink-0" />
        <span>SLA unavailable — invalid contract</span>
      </Badge>
    );
  }

  const phases = [
    { name: showDetails ? 'Acknowledgement' : 'Ack', phase: sla.ack },
    { name: showDetails ? 'Resolution' : 'Resolve', phase: sla.resolve },
  ];

  if (showDetails) {
    return (
      <div className={cn('space-y-3', className)}>
        {sla.clock.paused && (
          <Badge variant="warning" size="sm" className="gap-1.5">
            <Pause className="h-3 w-3" />
            <span>SLA clock paused</span>
          </Badge>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {phases.map(({ name, phase }) => {
            const config = getPhaseBadgeConfig(phase);
            const notRequired = phase.status === 'NOT_REQUIRED';
            const Icon = config.icon;

            return (
              <div
                key={name}
                className="flex flex-col justify-between rounded-xl border border-border/70 bg-card p-3.5 text-card-foreground shadow-xs transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-foreground">{name} SLA</span>
                  <Badge
                    variant={config.variant}
                    size="xs"
                    className="gap-1 font-bold uppercase tracking-wider"
                  >
                    <Icon className="h-3 w-3 shrink-0" />
                    <span>{config.label}</span>
                  </Badge>
                </div>

                {!notRequired && (
                  <div className="mt-3 space-y-2">
                    <div
                      className="h-1.5 w-full overflow-hidden rounded-full bg-muted/80"
                      role="progressbar"
                      aria-label={`${name} SLA progress`}
                      aria-valuenow={Math.round(phase.progress * 100)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <div
                        className={cn(
                          'h-full rounded-full transition-all duration-300',
                          config.barColor
                        )}
                        style={{ width: `${Math.min(phase.progress * 100, 100)}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>
                        Elapsed:{' '}
                        <strong className="font-semibold text-foreground">
                          {formatTimeMinutesMs(phase.elapsedMs)}
                        </strong>
                      </span>
                      <span>
                        Target:{' '}
                        <strong className="font-semibold text-foreground">
                          {formatTimeMinutesMs(phase.targetMs)}
                        </strong>
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <p className="text-[11px] text-muted-foreground/80">
          Contract: {sla.contract.priorityAtCapture ?? 'Fallback'} · policy v
          {sla.contract.policyVersion ?? 'legacy'} · {sla.contract.policyRule ?? 'base'}
        </p>
      </div>
    );
  }

  return (
    <div className={cn('inline-flex flex-wrap items-center gap-1.5', className)}>
      {sla.clock.paused && (
        <Badge
          variant="outline"
          size="xs"
          className="gap-1 border-amber-500/40 text-amber-600 dark:text-amber-400"
        >
          <Pause className="h-3 w-3" />
          <span>Paused</span>
        </Badge>
      )}

      {phases.map(({ name, phase }) => {
        const config = getPhaseBadgeConfig(phase);
        const notRequired = phase.status === 'NOT_REQUIRED';
        const Icon = config.icon;

        return (
          <Badge
            key={name}
            variant={config.variant}
            size="xs"
            className="gap-1 font-semibold"
            title={
              notRequired
                ? `${name}: Not required`
                : `${name}: ${formatTimeMinutesMs(phase.elapsedMs)} elapsed of ${formatTimeMinutesMs(phase.targetMs)} target`
            }
          >
            <Icon className="h-3 w-3 shrink-0" />
            <span className="font-semibold">{name}</span>
            <span className="text-[10px] font-bold uppercase tracking-wider opacity-90">
              {config.label}
            </span>
            {!notRequired && (
              <span className="hidden sm:inline font-mono text-[9px] opacity-80 border-l border-white/30 pl-1 ml-0.5">
                {formatTimeMinutesMs(phase.elapsedMs)}/{formatTimeMinutesMs(phase.targetMs)}
              </span>
            )}
          </Badge>
        );
      })}
    </div>
  );
}
