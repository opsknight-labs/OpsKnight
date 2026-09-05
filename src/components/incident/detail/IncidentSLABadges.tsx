'use client';

import { useMemo, useSyncExternalStore } from 'react';
import type { Incident, Service } from '@prisma/client';
import { calculateMTTA, calculateMTTR, checkAckSLA, checkResolveSLA } from '@/lib/sla';
import {
  getPrioritySLATarget,
  checkPriorityAckSLA,
  checkPriorityResolveSLA,
} from '@/lib/sla-priority';
import { formatTimeMinutes, formatTimeMinutesMs } from '@/lib/time-format';
import { CheckCircle2, AlertCircle, Timer, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';

const emptySubscribe = () => () => {};

type IncidentSLABadgesProps = {
  incident: Incident;
  service: Service;
  className?: string;
};

export default function IncidentSLABadges({
  incident,
  service,
  className,
}: IncidentSLABadgesProps) {
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  const {
    mtta,
    mttr,
    ackSlaMet,
    resolveSlaMet,
    ackTimeRemaining,
    resolveTimeRemaining,
    targetAckMinutes,
    targetResolveMinutes,
    ackProgress,
    resolveProgress,
  } = useMemo(() => {
    if (!mounted) {
      return {
        mtta: null,
        mttr: null,
        ackSlaMet: null,
        resolveSlaMet: null,
        ackTimeRemaining: null,
        resolveTimeRemaining: null,
        targetAckMinutes: 0,
        targetResolveMinutes: 0,
        ackProgress: 0,
        resolveProgress: 0,
      };
    }

    const mtta = calculateMTTA(incident);
    const mttr = calculateMTTR(incident);

    const priorityTarget = getPrioritySLATarget(incident.priority, service);
    const targetAckMinutes = priorityTarget.ack;
    const targetResolveMinutes = priorityTarget.resolve;

    const ackSlaMet = incident.acknowledgedAt
      ? incident.priority
        ? checkPriorityAckSLA(incident, service)
        : checkAckSLA(incident, service)
      : null;

    const resolveSlaMet = incident.resolvedAt
      ? incident.priority
        ? checkPriorityResolveSLA(incident, service)
        : checkResolveSLA(incident, service)
      : null;

    const now = new Date();
    const createdAtTime = new Date(incident.createdAt).getTime();
    const timeSinceCreation = (now.getTime() - createdAtTime) / (1000 * 60);

    const ackTimeRemaining =
      incident.status === 'OPEN' && !incident.acknowledgedAt
        ? targetAckMinutes - timeSinceCreation
        : null;

    const resolveTimeRemaining =
      incident.status !== 'RESOLVED' && !incident.resolvedAt
        ? targetResolveMinutes - timeSinceCreation
        : null;

    const ackProgress = incident.acknowledgedAt
      ? 100
      : Math.min(100, Math.max(0, (timeSinceCreation / Math.max(1, targetAckMinutes)) * 100));

    const resolveProgress = incident.resolvedAt
      ? 100
      : Math.min(100, Math.max(0, (timeSinceCreation / Math.max(1, targetResolveMinutes)) * 100));

    return {
      mtta,
      mttr,
      ackSlaMet,
      resolveSlaMet,
      ackTimeRemaining,
      resolveTimeRemaining,
      targetAckMinutes,
      targetResolveMinutes,
      ackProgress,
      resolveProgress,
    };
  }, [incident, service, mounted]);

  if (!mounted) {
    return (
      <div className={cn('flex items-center gap-2 pt-1', className)}>
        <div className="h-6 w-32 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
        <div className="h-6 w-36 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
      </div>
    );
  }

  // Determine Ack SLA state
  const isAckMet = Boolean(incident.acknowledgedAt && ackSlaMet);
  const isAckBreached = Boolean(
    (incident.acknowledgedAt && !ackSlaMet) ||
    (!incident.acknowledgedAt && ackTimeRemaining !== null && ackTimeRemaining <= 0)
  );
  const isAckPending = !incident.acknowledgedAt && !isAckBreached;

  // Determine Resolve SLA state
  const isResolveMet = Boolean(incident.resolvedAt && resolveSlaMet);
  const isResolveBreached = Boolean(
    (incident.resolvedAt && !resolveSlaMet) ||
    (!incident.resolvedAt && resolveTimeRemaining !== null && resolveTimeRemaining <= 0)
  );
  const isResolvePending = !incident.resolvedAt && !isResolveBreached;

  return (
    <div className={cn('flex flex-wrap items-center gap-2 pt-1.5', className)}>
      {/* Response Health label indicator */}
      <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mr-0.5">
        <Activity className="h-3 w-3 text-slate-400" />
        Response Health:
      </span>

      {/* Acknowledgement SLA Pill */}
      <div
        className={cn(
          'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-semibold shadow-2xs transition-all',
          isAckMet &&
            'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
          isAckBreached &&
            'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800',
          isAckPending &&
            'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
        )}
      >
        {isAckMet ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
        ) : isAckBreached ? (
          <AlertCircle className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400 shrink-0" />
        ) : (
          <Timer className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
        )}

        <span>{isAckMet ? 'Ack Met' : isAckBreached ? 'Ack Breached' : 'Ack Target'}</span>

        <span className="opacity-40">·</span>

        <span className="font-mono text-[11px] font-normal">
          {incident.acknowledgedAt
            ? `${formatTimeMinutesMs(mtta)} / ${targetAckMinutes}m target`
            : isAckBreached
              ? `Target was ${targetAckMinutes}m`
              : `${Math.round(ackTimeRemaining ?? 0)}m left (${targetAckMinutes}m target)`}
        </span>

        {/* Micro progress meter if not met */}
        {!isAckMet && (
          <div className="w-10 h-1.5 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden shrink-0 ml-0.5">
            <div
              className={cn(
                'h-full transition-all',
                isAckBreached ? 'bg-rose-500' : 'bg-amber-500'
              )}
              style={{ width: `${Math.round(Math.min(100, ackProgress))}%` }}
            />
          </div>
        )}
      </div>

      {/* Resolution SLA Pill */}
      <div
        className={cn(
          'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-semibold shadow-2xs transition-all',
          isResolveMet &&
            'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
          isResolveBreached &&
            'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800',
          isResolvePending &&
            'bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800'
        )}
      >
        {isResolveMet ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
        ) : isResolveBreached ? (
          <AlertCircle className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400 shrink-0" />
        ) : (
          <Timer className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
        )}

        <span>
          {isResolveMet ? 'Resolve Met' : isResolveBreached ? 'Resolve Breached' : 'Resolution'}
        </span>

        <span className="opacity-40">·</span>

        <span className="font-mono text-[11px] font-normal">
          {incident.resolvedAt
            ? `${formatTimeMinutesMs(mttr)} / ${formatTimeMinutes(targetResolveMinutes)} target`
            : isResolveBreached
              ? `Target was ${formatTimeMinutes(targetResolveMinutes)}`
              : `${Math.round(resolveTimeRemaining ?? 0)}m left (${formatTimeMinutes(targetResolveMinutes)} target)`}
        </span>

        {/* Micro progress meter if not met */}
        {!isResolveMet && (
          <div className="w-10 h-1.5 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden shrink-0 ml-0.5">
            <div
              className={cn(
                'h-full transition-all',
                isResolveBreached ? 'bg-rose-500' : 'bg-sky-500'
              )}
              style={{ width: `${Math.round(Math.min(100, resolveProgress))}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
