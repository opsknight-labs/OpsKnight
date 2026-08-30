import React, { type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

export type DetailStatItem = {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  subtext?: string;
  className?: string;
  valueClassName?: string;
  href?: string;
  active?: boolean;
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
      <div className="relative overflow-hidden rounded-lg bg-gradient-to-r from-primary to-primary/80 p-4 text-primary-foreground shadow-lg md:p-6">
        <div className="pointer-events-none absolute -right-24 -top-32 h-72 w-72 rounded-full bg-primary-foreground/[0.08] blur-3xl" />

        <div className="relative flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
          {/* Left: Icon/Avatar & Identity Details */}
          <div className="flex items-start gap-4">
            {icon && <div className="shrink-0">{icon}</div>}

            <div className="min-w-0">
              {(tag || badges) && (
                <div className="flex flex-wrap items-center gap-2">
                  {tag && (
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary-foreground/75">
                      {tag}
                    </p>
                  )}
                  {badges}
                </div>
              )}

              <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-primary-foreground md:text-3xl">
                {title}
              </h1>

              {subtitle && (
                <div className="mt-1 text-xs text-primary-foreground/85 leading-relaxed">
                  {subtitle}
                </div>
              )}
            </div>
          </div>

          {/* Right: Summary Metric Capsules & Action Slots (Inline mode) */}
          {(statsPlacement !== 'bottom' || bannerActions) && (
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              {statsPlacement !== 'bottom' && stats.length > 0 && (
                <div
                  className={cn(
                    'grid gap-1.5 rounded-lg border border-primary-foreground/20 bg-primary-foreground/10 p-1.5 backdrop-blur-sm',
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
                        <p className="text-[10px] font-medium uppercase tracking-wide text-primary-foreground/70">
                          {stat.label}
                        </p>
                        <div
                          className={cn(
                            'mt-0.5 flex items-center justify-center gap-1 text-sm font-semibold text-primary-foreground',
                            stat.valueClassName
                          )}
                        >
                          {stat.icon}
                          <span>{stat.value}</span>
                        </div>
                        {stat.subtext && (
                          <p className="text-[9px] text-primary-foreground/70 mt-0.5">
                            {stat.subtext}
                          </p>
                        )}
                      </>
                    );

                    const itemClassName = cn(
                      'min-w-0 rounded-md px-2.5 py-1.5 text-center transition-all duration-150',
                      idx > 0 && stats.length <= 3 && 'border-l border-primary-foreground/20',
                      idx > 0 &&
                        stats.length === 4 &&
                        'sm:border-l sm:border-primary-foreground/20',
                      idx % 2 === 1 &&
                        stats.length === 4 &&
                        'border-l border-primary-foreground/20 sm:border-l',
                      idx > 0 && stats.length >= 5 && 'lg:border-l lg:border-primary-foreground/20',
                      idx % 2 === 1 &&
                        stats.length >= 5 &&
                        'border-l border-primary-foreground/20 lg:border-l',
                      stat.href &&
                        'hover:bg-primary-foreground/15 hover:scale-[1.02] cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary-foreground/50',
                      stat.active &&
                        'bg-primary-foreground/20 ring-1 ring-inset ring-primary-foreground/30 font-bold',
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
                <>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-primary-foreground/75 truncate">
                    {stat.label}
                  </p>
                  <div
                    className={cn(
                      'mt-1 flex items-center justify-center gap-1.5 text-base sm:text-lg font-bold text-primary-foreground',
                      stat.valueClassName
                    )}
                  >
                    {stat.icon}
                    <span>{stat.value}</span>
                  </div>
                  {stat.subtext && (
                    <p className="text-[9px] text-primary-foreground/70 mt-0.5 truncate">
                      {stat.subtext}
                    </p>
                  )}
                </>
              );

              const itemClassName = cn(
                'min-w-0 rounded-lg border border-primary-foreground/20 bg-primary-foreground/10 p-2.5 text-center backdrop-blur-sm transition-all duration-150',
                stat.href &&
                  'hover:bg-primary-foreground/20 hover:scale-[1.01] hover:border-primary-foreground/30 cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary-foreground/50',
                stat.active &&
                  'bg-primary-foreground/25 border-primary-foreground/40 ring-1 ring-primary-foreground/40 font-bold',
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
