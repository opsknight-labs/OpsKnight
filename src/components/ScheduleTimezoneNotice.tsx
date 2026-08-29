'use client';

import { useState, useEffect } from 'react';
import { useTimezone } from '@/contexts/TimezoneContext';
import { cn } from '@/lib/utils';
import { Globe, Clock, ArrowRight, X, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/shadcn/badge';
import Link from 'next/link';

type ScheduleTimezoneNoticeProps = {
  scheduleTimeZone: string;
  className?: string;
};

export default function ScheduleTimezoneNotice({
  scheduleTimeZone,
  className,
}: ScheduleTimezoneNoticeProps) {
  const { userTimeZone, browserTimeZone } = useTimezone();
  const [isDismissed, setIsDismissed] = useState(false);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const initialUpdate = window.setTimeout(() => setNow(new Date()), 0);
    const interval = setInterval(() => setNow(new Date()), 30000);
    return () => {
      window.clearTimeout(initialUpdate);
      clearInterval(interval);
    };
  }, []);

  const localTz = browserTimeZone || userTimeZone || 'UTC';
  const hasProfileMismatch = Boolean(userTimeZone && scheduleTimeZone !== userTimeZone);
  const hasLocalMismatch = Boolean(localTz && scheduleTimeZone !== localTz);

  const shouldShow = hasProfileMismatch || hasLocalMismatch;

  const storageKey = `dismissed_tz_${scheduleTimeZone}_${userTimeZone}_${browserTimeZone}`;

  useEffect(() => {
    const readDismissal = window.setTimeout(() => {
      try {
        if (sessionStorage.getItem(storageKey) === 'true') {
          setIsDismissed(true);
        }
      } catch {
        // Ignore sessionStorage errors
      }
    }, 0);
    return () => window.clearTimeout(readDismissal);
  }, [storageKey]);

  const handleDismiss = () => {
    setIsDismissed(true);
    try {
      sessionStorage.setItem(storageKey, 'true');
    } catch {
      // Ignore sessionStorage errors
    }
  };

  if (!shouldShow || isDismissed) {
    return null;
  }

  // Format current times in both timezones
  const formatTzTime = (date: Date | null, tz: string) => {
    if (!date) return '--:--';
    try {
      return new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      }).format(date);
    } catch {
      return '--:--';
    }
  };

  const scheduleTimeStr = formatTzTime(now, scheduleTimeZone);
  const localTimeStr = formatTzTime(now, localTz);

  return (
    <div
      role="region"
      aria-label="Timezone Alignment Banner"
      className={cn(
        'relative overflow-hidden rounded-xl border p-3 sm:p-3.5 shadow-sm transition-all',
        hasProfileMismatch
          ? 'border-amber-500/30 bg-gradient-to-r from-amber-500/[0.12] via-amber-500/[0.04] to-card'
          : 'border-sky-500/30 bg-gradient-to-r from-sky-500/[0.10] via-indigo-500/[0.04] to-card',
        className
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Left: Icon & Explainer */}
        <div className="flex items-start sm:items-center gap-3 min-w-0">
          <div
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset',
              hasProfileMismatch
                ? 'bg-amber-500/15 text-amber-600 ring-amber-500/25 dark:text-amber-400'
                : 'bg-sky-500/15 text-sky-600 ring-sky-500/25 dark:text-sky-400'
            )}
          >
            {hasProfileMismatch ? (
              <AlertTriangle className="h-4 w-4" />
            ) : (
              <Globe className="h-4 w-4" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold uppercase tracking-wider text-foreground">
                {hasProfileMismatch ? 'Timezone Mismatch' : 'Timezone Context'}
              </span>
              <span className="text-xs text-muted-foreground hidden md:inline">·</span>
              <span className="text-xs text-muted-foreground">
                All shifts &amp; handoffs use{' '}
                <strong className="font-semibold text-foreground">{scheduleTimeZone}</strong>
              </span>
            </div>
            <p className="text-xs text-muted-foreground/90 mt-0.5">
              Shift calculations, calendar timelines, and alert delivery follow the schedule
              timezone.
            </p>
          </div>
        </div>

        {/* Right: Live Clocks & Dismiss */}
        <div className="flex items-center gap-2.5 shrink-0 self-end sm:self-center">
          <div className="flex items-center gap-1.5 rounded-lg border bg-background/80 px-2.5 py-1.5 text-xs shadow-2xs backdrop-blur-sm">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <div className="flex items-center gap-1.5 font-medium tabular-nums">
              <span className="text-foreground font-semibold">{scheduleTimeStr}</span>
              <Badge
                variant="secondary"
                size="xs"
                className="px-1.5 py-0 text-[10px] font-semibold"
              >
                {scheduleTimeZone}
              </Badge>
              <ArrowRight className="h-3 w-3 text-muted-foreground/60" />
              <span className="text-muted-foreground">{localTimeStr}</span>
              <Badge variant="outline" size="xs" className="px-1.5 py-0 text-[10px]">
                {localTz.split('/').pop()?.replace('_', ' ') || localTz}
              </Badge>
            </div>
          </div>

          {hasProfileMismatch && (
            <Link
              href="/settings/profile"
              className="text-xs font-medium text-primary underline underline-offset-2 hover:opacity-80 px-1"
            >
              Sync Profile
            </Link>
          )}

          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Dismiss timezone notice"
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
