'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Check,
  Loader2,
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
    acknowledgeIncident,
    isAcknowledging,
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

  const isP1 = currentIncident.priority === 'P1' || currentIncident.urgency === 'HIGH';
  const isAcked = currentIncident.status === 'ACKNOWLEDGED';
  const elapsed = formatElapsed(currentIncident.createdAt);

  return (
    <aside
      aria-label="Active critical incident notification"
      className={cn(
        'sticky top-0 z-30 w-full transition-all duration-200 border-b shadow-md text-xs sm:text-sm',
        isP1
          ? 'bg-rose-950/95 text-rose-50 border-rose-800/90 shadow-rose-950/20'
          : 'bg-amber-950/95 text-amber-50 border-amber-800/90 shadow-amber-950/20'
      )}
    >
      {/* Subtle top accent highlight stripe */}
      <div
        className={cn(
          'h-0.5 w-full',
          isP1
            ? 'bg-gradient-to-r from-rose-500 via-red-400 to-rose-500'
            : 'bg-gradient-to-r from-amber-500 via-orange-400 to-amber-500'
        )}
      />

      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-2 sm:py-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        {/* Left: Indicator & Title Telemetry */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
          {/* Animated beacon badge */}
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="relative flex h-2.5 w-2.5">
              {!isAcked && (
                <span
                  className={cn(
                    'animate-ping absolute inline-flex h-full w-full rounded-full opacity-75',
                    isP1 ? 'bg-rose-400' : 'bg-amber-400'
                  )}
                />
              )}
              <span
                className={cn(
                  'relative inline-flex rounded-full h-2.5 w-2.5',
                  isP1 ? 'bg-rose-500' : 'bg-amber-500'
                )}
              />
            </span>

            <span
              className={cn(
                'px-1.5 py-0.5 rounded text-[11px] font-black uppercase tracking-wider leading-none shadow-xs border',
                isP1
                  ? 'bg-rose-500/20 text-rose-200 border-rose-400/30'
                  : 'bg-amber-500/20 text-amber-200 border-amber-400/30'
              )}
            >
              {currentIncident.priority || (isP1 ? 'P1' : 'P2')}
            </span>
          </div>

          {/* Service tag & Incident Title */}
          <div className="min-w-0 flex items-center gap-1.5 sm:gap-2 flex-wrap sm:flex-nowrap">
            {currentIncident.service?.name && (
              <>
                <span className="font-semibold text-white/90 truncate max-w-[140px] sm:max-w-[200px] text-xs">
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
          <div className="hidden lg:flex items-center gap-2 shrink-0 text-xs text-white/70">
            <span className="text-white/30">&bull;</span>
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-white/80">
              <Clock size={12} className="opacity-70" />
              <span>Active for {elapsed}</span>
            </span>

            {isAcked ? (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-950/80 text-emerald-300 border border-emerald-700/60">
                Acknowledged
              </span>
            ) : (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-rose-900/60 text-rose-200 border border-rose-700/60">
                Triggered
              </span>
            )}
          </div>
        </div>

        {/* Right: Actions, Multi-incident carousel, and Dismiss */}
        <div className="flex items-center gap-2 shrink-0 ml-auto">
          {/* Multi-incident navigation if > 1 */}
          {totalCount > 1 && (
            <div className="flex items-center gap-1 bg-black/30 rounded-md px-1.5 py-0.5 border border-white/10 mr-1">
              <button
                type="button"
                onClick={prevIncident}
                className="h-5 w-5 rounded hover:bg-white/10 flex items-center justify-center text-white/80 hover:text-white transition-colors"
                aria-label="Previous critical incident"
              >
                <ChevronLeft size={13} />
              </button>
              <span className="text-[11px] font-semibold text-white/80 px-1 select-none">
                {currentIndex + 1} of {totalCount}
              </span>
              <button
                type="button"
                onClick={nextIncident}
                className="h-5 w-5 rounded hover:bg-white/10 flex items-center justify-center text-white/80 hover:text-white transition-colors"
                aria-label="Next critical incident"
              >
                <ChevronRight size={13} />
              </button>
            </div>
          )}

          {/* 1-Click Acknowledge Button (if not already acknowledged) */}
          {!isAcked && (
            <button
              type="button"
              onClick={() => acknowledgeIncident(currentIncident.id)}
              disabled={isAcknowledging}
              className={cn(
                'inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-semibold text-xs transition-all cursor-pointer shadow-xs border',
                'bg-white text-slate-950 hover:bg-slate-100 active:scale-95 disabled:opacity-50 border-white/40'
              )}
            >
              {isAcknowledging ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Check size={12} className="stroke-[3]" />
              )}
              <span>Acknowledge</span>
            </button>
          )}

          {/* View Details Link */}
          <Link
            href={`/incidents/${currentIncident.id}`}
            className={cn(
              'inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-semibold text-xs transition-all border shadow-xs',
              'bg-white/10 hover:bg-white/20 text-white border-white/20 hover:border-white/30'
            )}
          >
            <span>View</span>
            <ArrowRight size={12} />
          </Link>

          {/* Dismiss Button */}
          <button
            type="button"
            onClick={dismissBanner}
            className="h-7 w-7 rounded-md hover:bg-white/15 text-white/70 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
            title="Dismiss banner (reopens if a new P1 incident occurs)"
            aria-label="Dismiss banner"
          >
            <X size={15} />
          </button>
        </div>
      </div>
    </aside>
  );
}
