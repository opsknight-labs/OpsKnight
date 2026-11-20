'use client';

import React, { useEffect, useState, useCallback, useRef, memo } from 'react';

type LiveClockProps = {
  timeZone?: string;
  /** `plain` renders quiet inline text for dense headers. */
  variant?: 'badge' | 'plain';
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
const LiveClock = memo(function LiveClock({ timeZone = 'UTC', variant = 'badge' }: LiveClockProps) {
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

  if (variant === 'plain') {
    return (
      <span
        className="font-mono text-sm tabular-nums text-muted-foreground"
        role="timer"
        aria-label={time ? `Current time: ${time}` : 'Loading clock'}
      >
        {time ?? '--:--:--'}
        {timeZone === 'UTC' ? <span className="ml-1.5 text-muted-foreground/70">UTC</span> : null}
      </span>
    );
  }

  // Loading state matching mounted dimensions and typography
  if (!isMounted || time === null) {
    return (
      <div
        className="ok-inverse-surface flex select-none items-center gap-2.5 rounded-lg border border-border bg-card px-3.5 py-1.5 font-mono text-base text-muted-foreground shadow-sm"
        aria-label="Loading clock"
      >
        <div className="relative flex items-center justify-center">
          <span className="h-2 w-2 shrink-0 rounded-full bg-muted" aria-hidden="true" />
        </div>
        <span className="font-semibold tabular-nums tracking-widest opacity-50">--:--:--</span>
      </div>
    );
  }

  return (
    <div
      className="ok-inverse-surface flex select-none items-center gap-2.5 rounded-lg border border-border bg-card px-3.5 py-1.5 font-mono text-base text-foreground shadow-sm"
      role="timer"
      aria-label={`Current time: ${time}`}
    >
      <div className="relative flex items-center justify-center">
        <span className="h-2 w-2 shrink-0 rounded-full bg-status-ok" aria-hidden="true" />
      </div>
      <span className="font-semibold tabular-nums tracking-widest">{time}</span>
    </div>
  );
});

export default LiveClock;
