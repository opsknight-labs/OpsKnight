'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/shadcn/tooltip';
import {
  useRealtimeConnectionStatus,
  type RealtimeConnectionStatus,
} from '@/hooks/useRealtimeConnectionStatus';
import { notify } from '@/lib/toast';
import { cn } from '@/lib/utils';

const STATUS_COPY = new Map<RealtimeConnectionStatus, { label: string; detail: string }>([
  [
    'live',
    {
      label: 'Live',
      detail: 'Incidents, counts and alerts update in real time.',
    },
  ],
  [
    'connecting',
    {
      label: 'Connecting',
      detail: 'Opening the live update stream.',
    },
  ],
  [
    'reconnecting',
    {
      label: 'Reconnecting',
      detail: 'The live update stream dropped and is retrying. What you see may be out of date.',
    },
  ],
  [
    'offline',
    {
      label: 'Offline',
      detail:
        'No live updates. Check your network or reload the page; what you see may be out of date.',
    },
  ],
]);

function copyFor(status: RealtimeConnectionStatus) {
  return STATUS_COPY.get(status) ?? { label: 'Live', detail: '' };
}

/**
 * Announces status changes politely and toasts once when live updates come back after the
 * stream was offline. The first status is not announced.
 */
function useStatusAnnouncement(status: RealtimeConnectionStatus | null, toastOnRestore: boolean) {
  const previous = useRef<RealtimeConnectionStatus | null>(null);
  const wentOffline = useRef(false);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    const before = previous.current;
    previous.current = status;
    if (status === 'offline') wentOffline.current = true;
    const restored = status === 'live' && wentOffline.current;
    if (status === 'live') wentOffline.current = false;
    if (!status || !before || before === status) return;
    // The first connect is not news; only changes after it are announced.
    if (status === 'connecting' || before === 'connecting') return;
    const timer = window.setTimeout(() => {
      setAnnouncement(`Live updates: ${copyFor(status).label}`);
    }, 0);
    if (toastOnRestore && restored) {
      notify.success('Live updates restored', {
        id: 'realtime-restored',
        description: 'The console is receiving real-time updates again.',
      });
    }
    return () => window.clearTimeout(timer);
  }, [status, toastOnRestore]);

  return announcement;
}

const DOT_CLASS = new Map<RealtimeConnectionStatus, string>([
  ['live', 'bg-emerald-400'],
  ['connecting', 'bg-ink-400'],
  ['reconnecting', 'bg-amber-400 motion-safe:animate-pulse'],
  ['offline', 'bg-rose-400'],
]);

type ConnectionIndicatorProps = {
  /**
   * `topbar` sits on the always-dark console top bar and always shows the status.
   * `mobile` follows the theme and appears only while live updates are degraded.
   */
  variant?: 'topbar' | 'mobile';
};

export default function ConnectionIndicator({ variant = 'topbar' }: ConnectionIndicatorProps) {
  const status = useRealtimeConnectionStatus();
  const announcement = useStatusAnnouncement(status, variant === 'topbar');
  if (!status) return null;

  const { label, detail } = copyFor(status);
  const liveRegion = (
    <span className="sr-only" aria-live="polite" aria-atomic="true">
      {announcement}
    </span>
  );

  if (variant === 'mobile') {
    const degraded = status === 'reconnecting' || status === 'offline';
    return (
      <>
        {liveRegion}
        {degraded && (
          <span
            className={cn(
              'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium',
              status === 'offline'
                ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300'
                : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300'
            )}
            title={detail}
          >
            <span
              aria-hidden="true"
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                status === 'offline' ? 'bg-rose-500' : 'bg-amber-500 motion-safe:animate-pulse'
              )}
            />
            {label}
          </span>
        )}
      </>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      {liveRegion}
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            data-connection-status={status}
            className="inline-flex h-7 shrink-0 cursor-default items-center gap-1.5 rounded-full border border-border px-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span
              aria-hidden="true"
              className={cn('h-2 w-2 shrink-0 rounded-full', DOT_CLASS.get(status))}
            />
            <span aria-hidden="true" className="hidden xl:inline">
              {label}
            </span>
            <span className="sr-only">Live updates: {label}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end" className="max-w-[16rem] leading-snug">
          <p className="font-semibold">{label}</p>
          <p className="mt-0.5 text-muted-foreground">{detail}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
