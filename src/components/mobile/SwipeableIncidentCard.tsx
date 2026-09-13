'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Clock3 } from 'lucide-react';
import { motion, useAnimation, useMotionValue, useTransform, type PanInfo } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatRelativeShort } from '@/lib/mobile-time';
import { haptics } from '@/lib/haptics';
import { IncidentStatusBadge, IncidentUrgencyBadge } from '@/components/incident/IncidentSemanticBadge';

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
  isUpdating?: boolean;
}

export default function SwipeableIncidentCard({
  incident,
  onAcknowledge,
  onSnooze,
  isUpdating = false,
}: SwipeableIncidentCardProps) {
  const router = useRouter();
  const { userTimeZone } = useTimezone();
  const [gestureActive, setGestureActive] = useState(false);
  const controls = useAnimation();
  const x = useMotionValue(0);
  const statusKey = incident.status.toUpperCase();
  const timeAgo = formatRelativeShort(new Date(incident.createdAt), userTimeZone);

  const acknowledgeAction = statusKey === 'OPEN' && onAcknowledge ? onAcknowledge : null;
  const snoozeAction = statusKey === 'OPEN' && onSnooze ? onSnooze : null;
  const background = useTransform(
    x,
    [-120, 0, 120],
    [snoozeAction ? 'rgba(59,130,246,.12)' : 'transparent', 'transparent', acknowledgeAction ? 'rgba(245,158,11,.12)' : 'transparent']
  );

  const handleDragEnd = async (_: unknown, info: PanInfo) => {
    const threshold = 80;
    try {
      if (info.offset.x > threshold && acknowledgeAction) {
        haptics.success();
        acknowledgeAction(incident.id);
      } else if (info.offset.x < -threshold && snoozeAction) {
        haptics.selection();
        snoozeAction(incident.id);
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
    <div className="relative min-w-0 overflow-hidden rounded-xl" data-swipe-ignore="true">
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 flex items-center justify-between px-4 text-[11px] font-bold"
        style={{ background }}
      >
        <span className={acknowledgeAction ? 'text-amber-700 dark:text-amber-300' : 'opacity-0'}>ACK</span>
        <span className={snoozeAction ? 'text-blue-700 dark:text-blue-300' : 'opacity-0'}>SNOOZE</span>
      </motion.div>

      <motion.article
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.55}
        onDragStart={() => setGestureActive(true)}
        onDragEnd={handleDragEnd}
        animate={controls}
        style={{ x }}
        className={cn(
          'relative z-10 min-w-0 rounded-xl border border-border bg-card text-card-foreground shadow-[0_1px_2px_hsl(var(--foreground)/0.04)]',
          isUpdating && 'opacity-60'
        )}
      >
        <button
          type="button"
          onClick={openDetails}
          disabled={isUpdating}
          className="block w-full min-w-0 px-3.5 pb-2.5 pt-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          aria-label={`Open incident ${incident.title}`}
        >
          <div className="flex min-w-0 items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <IncidentStatusBadge status={incident.status} />
              <IncidentUrgencyBadge urgency={incident.urgency} />
            </div>
            <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-muted-foreground">
              <Clock3 className="h-3 w-3" aria-hidden="true" />
              <span suppressHydrationWarning>{timeAgo}</span>
            </span>
          </div>

          <h3 className="mt-2 line-clamp-2 break-words text-[13px] font-semibold leading-[1.35] text-foreground sm:text-sm">
            {incident.title}
          </h3>
        </button>

        <div className="flex min-h-11 items-center justify-between gap-3 border-t border-border/70 px-3.5 py-2">
          <span className="min-w-0 truncate text-[11px] font-medium text-muted-foreground">
            {incident.service?.name || 'Unassigned service'}
          </span>
          {acknowledgeAction ? (
            <button
              type="button"
              onClick={() => {
                haptics.success();
                acknowledgeAction(incident.id);
              }}
              disabled={isUpdating}
              className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-amber-500 px-3 text-[11px] font-bold text-white transition-colors hover:bg-amber-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            >
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              ACK
            </button>
          ) : (
            <button
              type="button"
              onClick={openDetails}
              disabled={isUpdating}
              className="inline-flex min-h-9 shrink-0 items-center rounded-lg px-2.5 text-[11px] font-semibold text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            >
              Open
            </button>
          )}
        </div>

        {isUpdating && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-background/55 backdrop-blur-[1px]">
            <span className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground shadow-sm">Updating…</span>
          </div>
        )}
      </motion.article>
    </div>
  );
}
