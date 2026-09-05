import React, { type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/shadcn/skeleton';

export type DetailStatItem = {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  subtext?: string;
  className?: string;
  valueClassName?: string;
  href?: string;
  active?: boolean;
  tooltip?: string;
};

export type DetailBreadcrumb = {
  label: string;
  href: string;
  current: string;
};

export type DetailHeroBannerProps = {
  breadcrumb?: DetailBreadcrumb;
  tag?: string;
  title: string;
  subtitle?: ReactNode;
  badges?: ReactNode;
  icon?: ReactNode;
  stats?: DetailStatItem[];
  statsPlacement?: 'inline' | 'bottom';
  actions?: ReactNode;
  action?: ReactNode;
  alert?: ReactNode;
  className?: string;
};

export default function DetailHeroBanner({
  breadcrumb,
  tag,
  title,
  subtitle,
  badges,
  icon,
  stats = [],
  statsPlacement = 'inline',
  actions,
  action,
  alert,
  className,
}: DetailHeroBannerProps) {
  const bannerActions = actions || action;
  return (
    <header className={cn('space-y-4', className)}>
      {/* Breadcrumb Trail */}
      {breadcrumb && (
        <Link
          href={breadcrumb.href}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>{breadcrumb.label}</span>
          <span className="opacity-40">/</span>
          <span className="font-medium text-foreground">{breadcrumb.current}</span>
        </Link>
      )}

      {/* Main Glassmorphic Hero Banner */}
      <div className="relative overflow-hidden rounded-xl border border-zinc-800/80 bg-gradient-to-b from-[#121216] to-[#09090b] p-4 sm:p-5 md:p-6 text-slate-100 shadow-xl ring-1 ring-white/5">
        <div className="pointer-events-none absolute -right-24 -top-32 h-72 w-72 rounded-full bg-white/[0.03] blur-3xl" />

        <div className="relative flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          {/* Left: Icon/Avatar & Identity Details */}
          <div className="flex items-start gap-3.5">
            {icon && <div className="shrink-0">{icon}</div>}

            <div className="min-w-0">
              {(tag || badges) && (
                <div className="flex flex-wrap items-center gap-2">
                  {tag && (
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                      {tag}
                    </p>
                  )}
                  {badges}
                </div>
              )}

              <h1 className="mt-1 text-xl sm:text-2xl font-extrabold tracking-tight text-white md:text-[1.65rem]">
                {title}
              </h1>

              {subtitle && (
                <div className="mt-1 text-xs text-slate-300 leading-relaxed">{subtitle}</div>
              )}
            </div>
          </div>

          {/* Right: Summary Metric Capsules & Action Slots (Inline mode) */}
          {(statsPlacement !== 'bottom' || bannerActions) && (
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              {statsPlacement !== 'bottom' && stats.length > 0 && (
                <div
                  className={cn(
                    'grid gap-1.5 rounded-xl border border-zinc-800/80 bg-zinc-900/60 p-1.5 backdrop-blur-xs shadow-xs',
                    stats.length === 1 && 'grid-cols-1 min-w-[120px]',
                    stats.length === 2 && 'grid-cols-2 min-w-[200px]',
                    stats.length === 3 && 'grid-cols-3 min-w-[280px]',
                    stats.length === 4 &&
                      'grid-cols-2 sm:grid-cols-4 min-w-[240px] sm:min-w-[360px]',
                    stats.length >= 5 &&
                      'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 min-w-[280px] lg:min-w-[480px]'
                  )}
                >
                  {stats.map((stat, idx) => {
                    const statContent = (
                      <>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                          {stat.label}
                        </p>
                        <div
                          className={cn(
                            'mt-0.5 flex items-center justify-center gap-1 text-sm font-bold text-white min-w-0 max-w-full',
                            stat.valueClassName
                          )}
                        >
                          {stat.icon && <span className="shrink-0">{stat.icon}</span>}
                          <span
                            className="truncate max-w-full"
                            title={
                              stat.tooltip ??
                              (typeof stat.value === 'string' ? stat.value : undefined)
                            }
                          >
                            {stat.value}
                          </span>
                        </div>
                        {stat.subtext && (
                          <p className="text-[9px] text-slate-400 mt-0.5 truncate">
                            {stat.subtext}
                          </p>
                        )}
                      </>
                    );

                    const itemClassName = cn(
                      'min-w-0 overflow-hidden rounded-lg px-2.5 py-1.5 text-center transition-all duration-150',
                      idx > 0 && stats.length <= 3 && 'border-l border-zinc-800/80',
                      idx > 0 && stats.length === 4 && 'sm:border-l sm:border-zinc-800/80',
                      idx % 2 === 1 &&
                        stats.length === 4 &&
                        'border-l border-zinc-800/80 sm:border-l',
                      idx > 0 && stats.length >= 5 && 'lg:border-l lg:border-zinc-800/80',
                      idx % 2 === 1 &&
                        stats.length >= 5 &&
                        'border-l border-zinc-800/80 lg:border-l',
                      stat.href &&
                        'hover:bg-zinc-800/60 hover:text-white cursor-pointer focus:outline-none focus:ring-1 focus:ring-zinc-400',
                      stat.active &&
                        'bg-zinc-800/80 border-zinc-700/80 ring-1 ring-white/10 font-bold',
                      stat.className
                    );

                    return stat.href ? (
                      <Link
                        key={stat.label || idx}
                        href={stat.href}
                        className={itemClassName}
                        aria-label={`Filter by ${stat.label}`}
                      >
                        {statContent}
                      </Link>
                    ) : (
                      <div key={stat.label || idx} className={itemClassName}>
                        {statContent}
                      </div>
                    );
                  })}
                </div>
              )}

              {bannerActions && <div className="shrink-0">{bannerActions}</div>}
            </div>
          )}
        </div>

        {/* Bottom Stats Grid (when statsPlacement === 'bottom') */}
        {statsPlacement === 'bottom' && stats.length > 0 && (
          <div
            className={cn(
              'mt-5 grid gap-2 sm:gap-3',
              stats.length === 1 && 'grid-cols-1',
              stats.length === 2 && 'grid-cols-2',
              stats.length === 3 && 'grid-cols-1 sm:grid-cols-3',
              stats.length === 4 && 'grid-cols-2 sm:grid-cols-4',
              stats.length >= 5 && 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5'
            )}
          >
            {stats.map((stat, idx) => {
              const statContent = (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 truncate w-full">
                    {stat.label}
                  </p>
                  <div
                    className={cn(
                      'mt-0.5 flex h-7 items-center justify-center gap-1.5 text-sm sm:text-base font-extrabold text-white min-w-0 max-w-full px-1',
                      stat.valueClassName
                    )}
                  >
                    {stat.icon && (
                      <span className="shrink-0 flex items-center justify-center">{stat.icon}</span>
                    )}
                    <span
                      className="truncate max-w-full leading-tight"
                      title={
                        stat.tooltip ?? (typeof stat.value === 'string' ? stat.value : undefined)
                      }
                    >
                      {stat.value}
                    </span>
                  </div>
                  {stat.subtext && (
                    <p className="text-[9px] text-slate-400 mt-0.5 truncate w-full">
                      {stat.subtext}
                    </p>
                  )}
                </div>
              );

              const itemClassName = cn(
                'min-w-0 overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-900/60 p-2.5 text-center shadow-xs transition-all duration-150 flex flex-col justify-center min-h-[72px]',
                stat.href &&
                  'hover:bg-zinc-800/60 hover:border-zinc-700/80 cursor-pointer focus:outline-none focus:ring-1 focus:ring-zinc-400',
                stat.active && 'bg-zinc-800/80 border-zinc-700/80 ring-1 ring-white/10 font-bold',
                stat.className
              );

              return stat.href ? (
                <Link
                  key={stat.label || idx}
                  href={stat.href}
                  className={itemClassName}
                  aria-label={`Filter by ${stat.label}`}
                >
                  {statContent}
                </Link>
              ) : (
                <div key={stat.label || idx} className={itemClassName}>
                  {statContent}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Optional Alert Banner */}
      {alert && <div>{alert}</div>}
    </header>
  );
}

export function DetailHeroBannerSkeleton({
  hasBreadcrumb = false,
  statsCount = 4,
  statsPlacement = 'inline',
  hasActions = true,
  className,
}: {
  hasBreadcrumb?: boolean;
  statsCount?: number;
  statsPlacement?: 'inline' | 'bottom';
  hasActions?: boolean;
  className?: string;
}) {
  return (
    <header className={cn('space-y-4', className)}>
      {hasBreadcrumb && (
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-20 bg-muted/60" />
          <span className="text-muted-foreground/40">/</span>
          <Skeleton className="h-4 w-28 bg-muted/60" />
        </div>
      )}

      {/* Main Glassmorphic Hero Banner Container */}
      <div className="relative overflow-hidden rounded-xl border border-zinc-800/80 bg-gradient-to-b from-[#121216] to-[#09090b] p-4 sm:p-5 md:p-6 shadow-xl ring-1 ring-white/5">
        <div className="pointer-events-none absolute -right-24 -top-32 h-72 w-72 rounded-full bg-white/[0.02] blur-3xl" />

        <div className="relative flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          {/* Left: Icon & Titles */}
          <div className="flex items-start gap-3.5">
            <Skeleton className="h-12 w-12 shrink-0 rounded-xl bg-zinc-800/80 ring-1 ring-white/10" />
            <div className="space-y-2 min-w-0">
              <Skeleton className="h-3.5 w-32 bg-zinc-800/80 rounded-sm" />
              <Skeleton className="h-6 sm:h-7 w-48 sm:w-56 bg-zinc-700/80 rounded-md" />
              <Skeleton className="h-3.5 w-64 sm:w-80 bg-zinc-800/60 rounded-sm" />
            </div>
          </div>

          {/* Right: Metric Capsules & Action Button */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            {statsCount > 0 && statsPlacement === 'inline' && (
              <div
                className={cn(
                  'grid gap-1.5 rounded-xl border border-zinc-800/80 bg-zinc-900/60 p-1.5 backdrop-blur-xs shadow-xs',
                  statsCount === 1 && 'grid-cols-1 min-w-[120px]',
                  statsCount === 2 && 'grid-cols-2 min-w-[200px]',
                  statsCount === 3 && 'grid-cols-3 min-w-[280px]',
                  statsCount === 4 && 'grid-cols-2 sm:grid-cols-4 min-w-[240px] sm:min-w-[360px]',
                  statsCount >= 5 &&
                    'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 min-w-[280px] lg:min-w-[480px]'
                )}
              >
                {Array.from({ length: statsCount }).map((_, idx) => (
                  <div
                    key={idx}
                    className={cn(
                      'min-w-0 rounded-lg px-2.5 py-1.5 flex flex-col items-center justify-center gap-1 min-h-[46px]',
                      idx > 0 && statsCount <= 3 && 'border-l border-zinc-800/80',
                      idx > 0 && statsCount === 4 && 'sm:border-l sm:border-zinc-800/80',
                      idx % 2 === 1 && statsCount === 4 && 'border-l border-zinc-800/80 sm:border-l'
                    )}
                  >
                    <Skeleton className="h-2.5 w-12 bg-zinc-800/80 rounded-xs" />
                    <Skeleton className="h-4 w-8 bg-zinc-700/80 rounded-xs" />
                  </div>
                ))}
              </div>
            )}

            {hasActions && (
              <Skeleton className="h-9 w-28 shrink-0 rounded-lg bg-zinc-800/90 ring-1 ring-white/10" />
            )}
          </div>
        </div>

        {/* Bottom stats if statsPlacement === 'bottom' */}
        {statsCount > 0 && statsPlacement === 'bottom' && (
          <div
            className={cn(
              'mt-5 grid gap-2 sm:gap-3',
              statsCount === 1 && 'grid-cols-1',
              statsCount === 2 && 'grid-cols-2',
              statsCount === 3 && 'grid-cols-1 sm:grid-cols-3',
              statsCount === 4 && 'grid-cols-2 sm:grid-cols-4',
              statsCount >= 5 && 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5'
            )}
          >
            {Array.from({ length: statsCount }).map((_, idx) => (
              <div
                key={idx}
                className="rounded-xl border border-zinc-800/80 bg-zinc-900/60 p-2.5 flex flex-col items-center justify-center gap-1.5 min-h-[72px]"
              >
                <Skeleton className="h-2.5 w-16 bg-zinc-800/80 rounded-xs" />
                <Skeleton className="h-5 w-10 bg-zinc-700/80 rounded-xs" />
              </div>
            ))}
          </div>
        )}
      </div>
    </header>
  );
}
