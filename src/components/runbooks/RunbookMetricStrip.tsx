import React, { type ReactNode } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

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
    <div
      className={cn(
        'grid gap-2.5 sm:gap-3',
        gridColsClass,
        className
      )}
    >
      {stats.map((stat, idx) => {
        const content = (
          <div
            key={stat.label || idx}
            className={cn(
              'group relative flex flex-col justify-between rounded-lg border bg-card/60 p-3 shadow-2xs transition-all hover:bg-card hover:border-primary/30',
              stat.active && 'ring-1 ring-primary/40 border-primary/40 bg-primary/5',
              stat.href && 'cursor-pointer'
            )}
          >
            <div className="flex items-center justify-between gap-1 text-xs text-muted-foreground">
              <span className="font-medium truncate">{stat.label}</span>
              {stat.icon && <span className="shrink-0 opacity-70 group-hover:opacity-100">{stat.icon}</span>}
            </div>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span
                className={cn(
                  'text-xl sm:text-2xl font-bold tracking-tight',
                  stat.tone === 'success' && 'text-emerald-600 dark:text-emerald-400',
                  stat.tone === 'warning' && 'text-amber-600 dark:text-amber-400',
                  stat.tone === 'danger' && 'text-rose-600 dark:text-rose-400',
                  stat.tone === 'info' && 'text-blue-600 dark:text-blue-400'
                )}
              >
                {stat.value}
              </span>
              {stat.subtext && (
                <span className="text-[11px] text-muted-foreground truncate">{stat.subtext}</span>
              )}
            </div>
          </div>
        );

        if (stat.href) {
          return (
            <Link key={stat.label || idx} href={stat.href} className="block no-underline">
              {content}
            </Link>
          );
        }

        return <div key={stat.label || idx}>{content}</div>;
      })}
    </div>
  );
}
