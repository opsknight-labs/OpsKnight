'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  X,
  Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIncidentAlert } from '@/contexts/IncidentAlertContext';

function formatElapsed(dateInput: string | Date): string {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  const now = Date.now();
  const diffMs = Math.max(0, now - date.getTime());
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m`;
  const diffHours = Math.floor(diffMins / 60);
  const remMins = diffMins % 60;
  return `${diffHours}h ${remMins}m`;
}

export default function GlobalIncidentBanner() {
  const {
    currentIncident,
    currentIndex,
    totalCount,
    isBannerVisible,
    nextIncident,
    prevIncident,
    dismissBanner,
  } = useIncidentAlert();

  // Tick for elapsed duration every 30 seconds
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 30000);
    return () => clearInterval(timer);
  }, []);

  if (!isBannerVisible || !currentIncident) {
    return null;
  }

  const isCritical = currentIncident.priority === 'P1' || currentIncident.urgency?.toUpperCase() === 'HIGH';
  const isAcked = currentIncident.status === 'ACKNOWLEDGED';
  const elapsed = formatElapsed(currentIncident.createdAt);

  const badgeLabel =
    currentIncident.priority ||
    (currentIncident.urgency?.toUpperCase() === 'HIGH'
      ? 'HIGH'
      : currentIncident.urgency?.toUpperCase() === 'MEDIUM'
        ? 'MEDIUM'
        : isCritical
          ? 'P1'
          : 'ALERT');

  return (
    <aside
      aria-label="Active critical incident notification"
      className={cn(
        'sticky top-0 z-30 w-full transition-all duration-200 border-b shadow-md text-xs sm:text-sm',
        isCritical
          ? 'bg-rose-700 dark:bg-rose-950/95 text-white dark:text-rose-50 border-rose-800 dark:border-rose-800/90 shadow-rose-900/20 dark:shadow-rose-950/20'
          : 'bg-amber-600 dark:bg-amber-950/95 text-white dark:text-amber-50 border-amber-700 dark:border-amber-800/90 shadow-amber-900/20 dark:shadow-amber-950/20'
      )}
    >
      {/* Subtle top accent highlight stripe */}
      <div
        className={cn(
          'h-0.5 w-full',
          isCritical
            ? 'bg-gradient-to-r from-rose-300 via-rose-100 to-rose-300 dark:from-rose-500 dark:via-red-400 dark:to-rose-500'
            : 'bg-gradient-to-r from-amber-300 via-amber-100 to-amber-300 dark:from-amber-500 dark:via-orange-400 dark:to-amber-500'
        )}
      />

      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-2 sm:py-2.5 flex items-center justify-between gap-x-4 gap-y-2">
        {/* Left: Indicator & Title Telemetry */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
          {/* Animated beacon badge */}
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="relative flex h-2.5 w-2.5">
              {!isAcked && (
                <span
                  className={cn(
                    'animate-ping absolute inline-flex h-full w-full rounded-full opacity-75',
                    isCritical ? 'bg-rose-200 dark:bg-rose-400' : 'bg-amber-200 dark:bg-amber-400'
                  )}
                />
              )}
              <span
                className={cn(
                  'relative inline-flex rounded-full h-2.5 w-2.5',
                  isCritical ? 'bg-white dark:bg-rose-500' : 'bg-white dark:bg-amber-500'
                )}
              />
            </span>

            <span
              className={cn(
                'px-1.5 py-0.5 rounded text-[11px] font-black uppercase tracking-wider leading-none shadow-xs border',
                isCritical
                  ? 'bg-black/20 dark:bg-rose-500/20 text-white dark:text-rose-200 border-white/25 dark:border-rose-400/30'
                  : 'bg-black/20 dark:bg-amber-500/20 text-white dark:text-amber-200 border-white/25 dark:border-amber-400/30'
              )}
            >
              {badgeLabel}
            </span>
          </div>

          {/* Service tag & Incident Title */}
          <div className="min-w-0 flex items-center gap-1.5 sm:gap-2 flex-wrap sm:flex-nowrap">
            {currentIncident.service?.name && (
              <>
                <span className="font-bold text-white/95 truncate max-w-[140px] sm:max-w-[200px] text-xs">
                  {currentIncident.service.name}
                </span>
                <span className="text-white/40 hidden sm:inline">&middot;</span>
              </>
            )}

            <Link
              href={`/incidents/${currentIncident.id}`}
              className="font-medium text-white hover:underline truncate max-w-[240px] sm:max-w-[360px] md:max-w-[480px] transition-colors"
              title={currentIncident.title}
            >
              {currentIncident.title}
            </Link>
          </div>

          {/* Elapsed Time & Status Badge */}
          <div className="hidden lg:flex items-center gap-2 shrink-0 text-xs text-white/80">
            <span className="text-white/40">&bull;</span>
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-white/90">
              <Clock size={12} className="opacity-80" />
              <span>Active for {elapsed}</span>
            </span>

            {isAcked ? (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-950/80 text-emerald-300 border border-emerald-700/60">
                Acknowledged
              </span>
            ) : (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-black/25 dark:bg-rose-900/60 text-white dark:text-rose-200 border border-white/20 dark:border-rose-700/60">
                Triggered
              </span>
            )}
          </div>
        </div>

        {/* Right: Actions, Multi-incident carousel, and Dismiss */}
        <div className="flex items-center gap-2 shrink-0 ml-auto">
          {/* Multi-incident navigation if > 1 */}
          {totalCount > 1 && (
            <div className="flex items-center gap-1 bg-black/25 dark:bg-black/40 rounded-md px-1.5 py-0.5 border border-white/20 shrink-0 mr-1">
              <button
                type="button"
                onClick={prevIncident}
                className="h-5.5 w-5.5 rounded bg-white/10 hover:bg-white/25 flex items-center justify-center text-white shrink-0 border border-white/15 transition-colors cursor-pointer"
                aria-label="Previous critical incident"
              >
                <ChevronLeft size={13} className="shrink-0 stroke-[2.5]" />
              </button>
              <span className="text-[11px] font-bold text-white px-1 select-none shrink-0 tabular-nums">
                {currentIndex + 1} of {totalCount}
              </span>
              <button
                type="button"
                onClick={nextIncident}
                className="h-5.5 w-5.5 rounded bg-white/10 hover:bg-white/25 flex items-center justify-center text-white shrink-0 border border-white/15 transition-colors cursor-pointer"
                aria-label="Next critical incident"
              >
                <ChevronRight size={13} className="shrink-0 stroke-[2.5]" />
              </button>
            </div>
          )}

          {/* View Details Link */}
          <Link
            href={`/incidents/${currentIncident.id}`}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1 rounded-md font-semibold text-xs transition-all border shadow-xs shrink-0',
              'bg-white/15 hover:bg-white/25 active:bg-white/30 text-white border-white/30 hover:border-white/50 focus:outline-none focus:ring-2 focus:ring-white/60'
            )}
          >
            <span>View</span>
            <ArrowRight size={12} className="shrink-0 stroke-[2.5]" />
          </Link>

          {/* Dismiss Button - High contrast, explicit solid/elevated container visible in both dark & light browser configs */}
          <button
            type="button"
            onClick={dismissBanner}
            className={cn(
              'inline-flex items-center justify-center h-7 w-7 rounded-md shrink-0 transition-all cursor-pointer shadow-xs border',
              'bg-white/15 hover:bg-white/25 active:bg-white/30 text-white border-white/30 hover:border-white/50 focus:outline-none focus:ring-2 focus:ring-white/60'
            )}
            title="Dismiss banner (auto-dismisses after 120s, reopens if a new P1 or high-urgency incident occurs)"
            aria-label="Dismiss banner"
          >
            <X size={15} className="shrink-0 stroke-[2.5] text-white" />
            <span className="sr-only">Dismiss banner</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
