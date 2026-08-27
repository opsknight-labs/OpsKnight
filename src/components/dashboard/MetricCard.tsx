'use client';

import React, { useEffect, useState, useRef, memo } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import type { MetricDataState } from '@/lib/metric-contract';

type MetricCardProps = {
  label: string;
  value: number | string;
  rangeLabel?: string;
  isDark?: boolean;
  variant?: 'default' | 'hero';
  description?: string;
  href?: string;
  tooltip?: string;
  dataState?: MetricDataState;
  asOf?: string;
};

/**
 * Optimized count-up hook with stable animation
 */
const useCountUp = (end: number, duration = 800) => {
  const [count, setCount] = useState(0);
  const animationRef = useRef<number | null>(null);
  const prevEndRef = useRef<number>(end);

  useEffect(() => {
    // Guard against invalid values
    if (!Number.isFinite(end) || end < 0) {
      setCount(0);
      return;
    }

    // Skip animation if value hasn't changed
    if (prevEndRef.current === end && count === end) {
      return;
    }
    prevEndRef.current = end;

    // For zero, just set immediately
    if (end === 0) {
      setCount(0);
      return;
    }

    let startTime: number | null = null;
    const startValue = count;

    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const elapsed = timestamp - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Ease out quartic for smooth deceleration
      const ease = 1 - Math.pow(1 - progress, 4);

      const newCount = Math.round(startValue + (end - startValue) * ease);
      setCount(newCount);

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        // Ensure we end exactly at the target
        setCount(end);
      }
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };
  }, [end, duration, count]);

  return count;
};

/**
 * MetricCard Component
 * Displays a single metric with optional animation and range label
 */
const MetricCard = memo(function MetricCard({
  label,
  value,
  rangeLabel,
  isDark = false,
  variant = 'default',
  description,
  href,
  tooltip,
  dataState = 'available',
  asOf,
}: MetricCardProps) {
  // Parse value and determine if we should animate
  const { shouldAnimate, numericEnd, displayString } = React.useMemo(() => {
    if (typeof value === 'number') {
      // Guard against NaN and infinity
      if (!Number.isFinite(value)) {
        return { shouldAnimate: false, numericEnd: 0, displayString: 'N/A' };
      }
      return { shouldAnimate: true, numericEnd: Math.max(0, value), displayString: '' };
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      // Empty string
      if (trimmed === '') {
        return { shouldAnimate: false, numericEnd: 0, displayString: '0' };
      }
      // Check if it looks like a pure number (allowing commas)
      const clean = trimmed.replace(/,/g, '');
      const parsed = Number(clean);
      if (!isNaN(parsed) && Number.isFinite(parsed) && /^[\d,]+$/.test(trimmed)) {
        return { shouldAnimate: true, numericEnd: Math.max(0, parsed), displayString: '' };
      }
      // Keep as string (e.g., percentages, special values)
      return { shouldAnimate: false, numericEnd: 0, displayString: trimmed };
    }

    return { shouldAnimate: false, numericEnd: 0, displayString: String(value ?? 'N/A') };
  }, [value]);

  const animatedValue = useCountUp(shouldAnimate ? numericEnd : 0);

  // Format the display value
  const formattedDisplay =
    dataState === 'unavailable' || dataState === 'no_data'
      ? 'N/A'
      : shouldAnimate
        ? animatedValue.toLocaleString()
        : displayString;

  const isHero = variant === 'hero';

  const card = (
    <div
      className={cn(
        'relative overflow-hidden text-center transition-all duration-300',
        isHero
          ? 'rounded-lg'
          : 'group rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 via-white to-primary/5 shadow-sm hover:shadow-md',
        isHero ? 'transform-gpu' : 'transform-gpu',
        isDark
          ? 'bg-white/[0.03] border border-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] hover:bg-white/[0.08] hover:border-white/20'
          : isHero
            ? 'bg-white/10 border border-white/20 backdrop-blur text-primary-foreground shadow-sm hover:bg-white/15'
            : '',
        isHero ? 'p-3 md:p-4' : 'p-6 sm:p-4'
      )}
      role="figure"
      aria-label={`${label}: ${formattedDisplay}${description ? `. ${description}` : ''}${rangeLabel ? ` ${rangeLabel}` : ''}`}
      title={tooltip}
    >
      {/* Accent bar for default variant */}
      {!isDark && !isHero && (
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-primary to-primary/60" />
      )}
      {/* Hover glow effect for dark mode */}
      {isDark && (
        <div className="absolute top-0 -left-full w-3/5 h-full bg-gradient-to-r from-transparent via-white/[0.08] to-transparent skew-x-[-20deg] transition-[left] duration-600 pointer-events-none z-0 hover:left-[200%] hover:duration-800" />
      )}

      <div
        className={cn(
          'text-3xl sm:text-2xl font-bold mb-1.5 leading-tight tabular-nums relative z-10',
          isDark ? 'text-white' : isHero ? 'text-primary-foreground' : 'text-foreground'
        )}
        aria-live="polite"
      >
        {formattedDisplay}
      </div>
      <div
        className={cn(
          'text-xs font-medium uppercase tracking-wide relative z-10',
          isDark ? 'text-white/70' : isHero ? 'text-primary-foreground/80' : 'text-muted-foreground'
        )}
      >
        {label} {rangeLabel && <span className="opacity-80 text-[0.7rem]">{rangeLabel}</span>}
      </div>
      {description && (
        <div
          className={cn(
            'mt-1 text-[0.7rem] leading-tight relative z-10',
            isDark || isHero ? 'text-white/75' : 'text-muted-foreground'
          )}
        >
          {description}
        </div>
      )}
      {dataState !== 'available' && (
        <div
          className={cn(
            'mt-1 text-[0.65rem] font-semibold uppercase tracking-wide relative z-10',
            isDark || isHero ? 'text-amber-100' : 'text-amber-700'
          )}
          role="status"
        >
          {dataState === 'unavailable'
            ? 'Data unavailable'
            : dataState === 'no_data'
              ? 'No qualifying data'
              : `${dataState} data`}
        </div>
      )}
      {asOf && dataState !== 'unavailable' && (
        <span className="sr-only">Data calculated at {asOf}</span>
      )}
    </div>
  );

  if (!href) return card;

  return (
    <Link
      href={href}
      className="block rounded-lg no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-primary"
      aria-label={`View ${label.toLowerCase()} incidents`}
    >
      {card}
    </Link>
  );
});

export default MetricCard;
