import type { ReactNode } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { TONE_TEXT } from './ui/primitives';

export type MetricItem = {
  label: string;
  value: ReactNode;
  subtext?: string;
  href?: string;
  active?: boolean;
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  icon?: ReactNode;
};

export type RunbookMetricStripProps = {
  stats: MetricItem[];
  className?: string;
};

export function RunbookMetricStrip({ stats, className }: RunbookMetricStripProps) {
  if (!stats || stats.length === 0) return null;

  const gridColsClass =
    stats.length === 1
      ? 'grid-cols-1'
      : stats.length === 2
        ? 'grid-cols-1 sm:grid-cols-2'
        : stats.length === 3
          ? 'grid-cols-1 sm:grid-cols-3'
          : stats.length === 4
            ? 'grid-cols-2 lg:grid-cols-4'
            : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5';

  return (
    <div className={cn('grid gap-3', gridColsClass, className)}>
      {stats.map((stat, idx) => {
        const toneClass =
          stat.tone && stat.tone !== 'default' ? TONE_TEXT[stat.tone] : 'text-foreground';
        const body = (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs font-medium text-muted-foreground">
                {stat.label}
              </span>
              {stat.icon ? (
                <span className={cn('shrink-0', toneClass)}>{stat.icon}</span>
              ) : (
                stat.tone &&
                stat.tone !== 'default' && (
                  <span
                    aria-hidden="true"
                    className={cn('h-2 w-2 shrink-0 rounded-full', TONE_DOT[stat.tone])}
                  />
                )
              )}
            </div>
            <div
              className={cn('mt-2 text-2xl font-semibold tracking-tight tabular-nums', toneClass)}
            >
              {stat.value}
            </div>
            {stat.subtext && (
              <div className="mt-1 truncate text-xs text-muted-foreground">{stat.subtext}</div>
            )}
          </>
        );
        const classes = cn(
          'block h-full min-w-0 rounded-xl border bg-card p-4 shadow-xs transition-colors',
          stat.href &&
            'hover:border-primary/40 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          stat.active && 'border-primary/50 bg-primary/5 ring-1 ring-primary/30'
        );

        return stat.href ? (
          <Link
            key={stat.label || idx}
            href={stat.href}
            aria-current={stat.active ? 'true' : undefined}
            className={classes}
          >
            {body}
          </Link>
        ) : (
          <div key={stat.label || idx} className={classes}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

const TONE_DOT = {
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-rose-500',
  info: 'bg-sky-500',
} as const;
