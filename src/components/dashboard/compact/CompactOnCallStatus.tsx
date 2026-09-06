'use client';

import { memo, useMemo } from 'react';

// Flexible interface to accept shifts from various sources

type OnCallShift = {
  id?: string;
  start?: Date | string;
  end?: Date | string;
  user?: { name: string | null } | { name: string };
  schedule?: { name: string };
  [key: string]: unknown;
};

interface CompactOnCallStatusProps {
  activeShifts: OnCallShift[];
}

/**
 * Safely parses a date value, returning null for invalid inputs
 */
function safeParseDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;

  try {
    const date = value instanceof Date ? value : new Date(value);
    return isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

/**
 * Compact On-Call Status Widget
 * Shows current on-call status with remaining time
 */
const CompactOnCallStatus = memo(function CompactOnCallStatus({
  activeShifts,
}: CompactOnCallStatusProps) {
  // Memoize the shifts array to prevent unnecessary recalculations
  const shifts = useMemo(() => (Array.isArray(activeShifts) ? activeShifts : []), [activeShifts]);
  const isOnCall = shifts.length > 0;

  // Memoize calculations to prevent unnecessary recalculations
  const { endDate, hoursRemaining, endTimeStr } = useMemo(() => {
    if (!isOnCall || shifts.length === 0) {
      return { endDate: null, hoursRemaining: 0, endTimeStr: '' };
    }

    const shift = shifts[0];
    const end = safeParseDate(shift?.end);
    const now = new Date();

    if (!end) {
      return { endDate: null, hoursRemaining: 0, endTimeStr: 'Unknown' };
    }

    const msRemaining = Math.max(0, end.getTime() - now.getTime());
    const hours = Math.floor(msRemaining / (1000 * 60 * 60));

    let endStr: string;
    try {
      endStr = end.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
    } catch {
      endStr = end.toISOString().slice(11, 16);
    }

    return {
      endDate: end,
      hoursRemaining: hours,
      endTimeStr: endStr,
    };
  }, [isOnCall, shifts]);

  if (!isOnCall) {
    return (
      <div
        className="p-3.5 rounded-sm bg-neutral-50 border border-border text-center"
        role="status"
        aria-label="Not currently on-call"
      >
        <div className="text-sm text-muted-foreground font-medium">Not currently on-call</div>
      </div>
    );
  }

  // Handle case where end date couldn't be parsed
  if (!endDate) {
    return (
      <div
        className="p-3.5 rounded-sm bg-green-600 border border-green-600 text-white"
        role="status"
        aria-label="Currently on-call"
      >
        <div className="flex items-center gap-2">
          <div
            className="w-1.5 h-1.5 rounded-full bg-white shadow-[0_0_6px_rgba(255,255,255,0.6)]"
            aria-hidden="true"
          />
          <span className="text-sm font-semibold">On-Call Now</span>
        </div>
      </div>
    );
  }

  const remainingDisplay = hoursRemaining > 0 ? `${hoursRemaining}h left` : '<1h left';

  return (
    <div
      className="p-3.5 rounded-sm bg-green-600 border border-green-600 text-white"
      role="status"
      aria-label={`On-call now, ${remainingDisplay}, until ${endTimeStr}`}
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <div
            className="w-1.5 h-1.5 rounded-full bg-white shadow-[0_0_6px_rgba(255,255,255,0.6)] animate-pulse"
            aria-hidden="true"
          />
          <span className="text-sm font-semibold">On-Call Now</span>
        </div>
        <span className="text-xs opacity-85">{remainingDisplay}</span>
      </div>
      <div className="text-xs opacity-85">Until {endTimeStr}</div>
    </div>
  );
});

export default CompactOnCallStatus;
