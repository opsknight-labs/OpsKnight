'use client';

import React, { useEffect, useState, useCallback, useRef, memo } from 'react';
import { cn } from '@/lib/utils';

type LiveClockProps = {
  timeZone?: string;
};

/**
 * Validates if a timezone string is valid
 */
function isValidTimeZone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * LiveClock Component
 * Displays a live-updating clock with timezone support
 * Redesigned to match dark-themed "hacker" aesthetic
 */
const LiveClock = memo(function LiveClock({ timeZone = 'UTC' }: LiveClockProps) {
  const [time, setTime] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Validate and normalize timezone
  const validTimeZone = isValidTimeZone(timeZone) ? timeZone : 'UTC';

  const formatTime = useCallback(() => {
    try {
      return new Date().toLocaleTimeString('en-US', {
        hour12: false,
        timeZone: validTimeZone,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      // Ultimate fallback
      return new Date().toISOString().slice(11, 19);
    }
  }, [validTimeZone]);

  useEffect(() => {
    // Mark as mounted to enable client-side rendering
    setIsMounted(true);

    // Set initial time after mount to avoid hydration mismatch
    setTime(formatTime());

    // Update every second
    timerRef.current = setInterval(() => {
      setTime(formatTime());
    }, 1000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [formatTime]);

  // Loading state matching mounted dimensions and typography
  if (!isMounted || time === null) {
    return (
      <div
        className="font-mono text-base bg-gradient-to-b from-[#18181b] to-[#121216] border border-zinc-700/60 text-zinc-400 px-3.5 py-1.5 rounded-lg flex items-center gap-2.5 shadow-md shadow-black/25 ring-1 ring-white/5 select-none"
        aria-label="Loading clock"
      >
        <div className="relative flex items-center justify-center">
          <span className="h-2 w-2 rounded-full bg-zinc-600 shrink-0" aria-hidden="true" />
        </div>
        <span className="tracking-[0.1em] font-semibold opacity-50">--:--:--</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'font-mono text-base bg-gradient-to-b from-[#18181b] to-[#121216] border border-zinc-700/60 text-zinc-100 px-3.5 py-1.5 rounded-lg flex items-center gap-2.5 shadow-md shadow-black/25 ring-1 ring-white/5 select-none'
      )}
      role="timer"
      aria-label={`Current time: ${time}`}
    >
      <div className="relative flex items-center justify-center">
        <span className="relative flex h-2 w-2">
          <span className="animate-pulse absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-50" />
          <span
            className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]"
            aria-hidden="true"
          />
        </span>
      </div>
      <span className="tracking-[0.1em] font-semibold text-white text-base">{time}</span>
    </div>
  );
});

export default LiveClock;
