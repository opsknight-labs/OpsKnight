'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronRight, Clock3 } from 'lucide-react';
import { motion, useAnimation, useMotionValue, useTransform, type PanInfo } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatRelativeShort } from '@/lib/mobile-time';
import { haptics } from '@/lib/haptics';

interface SwipeableIncidentCardProps {
  incident: {
    id: string;
    title: string;
    status: string;
    urgency?: string | null;
    createdAt: string | Date;
    service?: { name: string } | null;
  };
  onAcknowledge?: (id: string) => void;
  onSnooze?: (id: string) => void;
  onResolve?: (id: string) => void;
  isUpdating?: boolean;
}

function statusClasses(status: string) {
  switch (status.toUpperCase()) {
    case 'OPEN':
      return 'border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300';
    case 'ACKNOWLEDGED':
      return 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300';
    case 'RESOLVED':
      return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
    case 'SNOOZED':
      return 'border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-300';
    default:
      return 'border-border bg-muted text-muted-foreground';
  }
}

function urgencyClasses(urgency?: string | null) {
  switch (urgency?.toUpperCase()) {
    case 'HIGH':
      return 'bg-red-500 text-white';
    case 'MEDIUM':
      return 'bg-amber-500 text-white';
    case 'LOW':
      return 'bg-muted text-muted-foreground';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

export default function SwipeableIncidentCard({
  incident,
  onAcknowledge,
  onSnooze,
  onResolve,
  isUpdating = false,
}: SwipeableIncidentCardProps) {
  const router = useRouter();
  const { userTimeZone } = useTimezone();
  const [gestureActive, setGestureActive] = useState(false);
  const controls = useAnimation();
  const x = useMotionValue(0);
  const statusKey = incident.status.toUpperCase();
  const timeAgo = formatRelativeShort(new Date(incident.createdAt), userTimeZone);

  const leftAction =
    statusKey === 'OPEN' && onAcknowledge
      ? { label: 'ACK', handler: onAcknowledge }
      : null;
  const rightAction =
    statusKey === 'OPEN' && onSnooze
      ? { label: 'SNOOZE', handler: onSnooze, tone: 'blue' as const }
      : statusKey !== 'RESOLVED' && onResolve
        ? { label: 'RESOLVE', handler: onResolve, tone: 'green' as const }
        : null;

  const background = useTransform(
    x,
    [-140, 0, 140],
    [
      rightAction?.tone === 'blue' ? 'rgba(59,130,246,.14)' : rightAction ? 'rgba(16,185,129,.14)' : 'transparent',
      'transparent',
      leftAction ? 'rgba(245,158,11,.14)' : 'transparent',
    ]
  );

  const handleDragEnd = async (_: unknown, info: PanInfo) => {
    const threshold = 84;
    try {
      if (info.offset.x > threshold && leftAction) {
        haptics.success();
        leftAction.handler(incident.id);
      } else if (info.offset.x < -threshold && rightAction) {
        haptics.success();
        rightAction.handler(incident.id);
      }
    } finally {
      await controls.start({ x: 0 });
      setGestureActive(false);
    }
  };

  const openDetails = () => {
    if (isUpdating || gestureActive) return;
    haptics.soft();
    router.push(`/m/incidents/${incident.id}`);
  };

  return (
    <div className="relative min-w-0 overflow-hidden rounded-2xl" data-swipe-ignore="true">
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 flex items-center justify-between px-5 text-xs font-bold"
        style={{ background }}
      >
        <span className={leftAction ? 'text-amber-600 dark:text-amber-300' : 'opacity-0'}>{leftAction?.label}</span>
        <span className={rightAction?.tone === 'blue' ? 'text-blue-600 dark:text-blue-300' : 'text-emerald-600 dark:text-emerald-300'}>
          {rightAction?.label}
        </span>
      </motion.div>

      <motion.div
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.65}
        onDragStart={() => setGestureActive(true)}
        onDragEnd={handleDragEnd}
        animate={controls}
        style={{ x }}
        className={cn(
          'relative z-10 min-w-0 rounded-2xl border border-border bg-card text-card-foreground shadow-sm',
          isUpdating && 'opacity-60'
        )}
      >
        <button
          type="button"
          onClick={openDetails}
          disabled={isUpdating}
          className="block min-h-11 w-full min-w-0 p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          aria-label={`Open incident ${incident.title}`}
        >
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <span className={cn('rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide', statusClasses(incident.status))}>
                  {incident.status}
                </span>
                {incident.urgency && (
                  <span className={cn('rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide', urgencyClasses(incident.urgency))}>
                    {incident.urgency}
                  </span>
                )}
              </div>
              <h3 className="mt-2 line-clamp-2 break-words text-sm font-semibold leading-snug text-foreground">
                {incident.title}
              </h3>
              <div className="mt-2 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                {incident.service?.name && <span className="truncate">{incident.service.name}</span>}
                {incident.service?.name && <span aria-hidden="true">•</span>}
                <Clock3 className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="shrink-0" suppressHydrationWarning>{timeAgo}</span>
              </div>
            </div>
            <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </div>
        </button>

        <div className="flex items-center gap-2 border-t border-border px-3 py-2.5">
          {leftAction && (
            <button
              type="button"
              onClick={() => {
                haptics.success();
                leftAction.handler(incident.id);
              }}
              disabled={isUpdating}
              className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-amber-500 px-3 text-xs font-bold text-white transition hover:bg-amber-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            >
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              Acknowledge
            </button>
          )}
          <button
            type="button"
            onClick={openDetails}
            disabled={isUpdating}
            className="inline-flex min-h-10 flex-1 items-center justify-center rounded-xl border border-border bg-background px-3 text-xs font-semibold text-foreground transition hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          >
            View details
          </button>
        </div>

        {isUpdating && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-2xl bg-background/55 backdrop-blur-[1px]">
            <span className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground shadow-sm">Updating…</span>
          </div>
        )}
      </motion.div>
    </div>
  );
}
