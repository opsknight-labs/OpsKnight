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
  /** Custom breadcrumb trail rendered above the banner (e.g. `<Breadcrumbs>`); wins over `breadcrumb`. */
  breadcrumbSlot?: ReactNode;
  tag?: string;
  title: string;
  subtitle?: ReactNode;
  badges?: ReactNode;
  icon?: ReactNode;
  stats?: DetailStatItem[];
  /** @deprecated Stats always render in the strip under the title. */
  statsPlacement?: 'inline' | 'bottom';
  actions?: ReactNode;
  action?: ReactNode;
  alert?: ReactNode;
  className?: string;
};

/** One stat tile; shared by the inline strip and the bottom grid so both look the same. */
function HeroStat({ stat, layoutClass }: { stat: DetailStatItem; layoutClass?: string }) {
  const content = (
    <>
      <span className="block truncate text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
        {stat.href && <span className="sr-only">Filter by </span>}
        {stat.label}
      </span>
      <span
        className={cn(
          'mt-0.5 flex min-w-0 items-center gap-1.5 text-base font-semibold leading-tight text-foreground tabular-nums',
          stat.valueClassName
        )}
      >
        {stat.icon && (
          <span className="flex shrink-0 items-center [&_svg]:h-4 [&_svg]:w-4" aria-hidden="true">
            {stat.icon}
          </span>
        )}
        <span
          className="truncate"
          title={stat.tooltip ?? (typeof stat.value === 'string' ? stat.value : undefined)}
        >
          {stat.value}
        </span>
      </span>
      {stat.subtext && (
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{stat.subtext}</span>
      )}
    </>
  );

  const className = cn(
    'block min-w-0 bg-card px-3 py-2.5 text-left transition-colors duration-150',
    layoutClass,
    stat.href &&
      'hover:bg-muted focus-visible:relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
    stat.active && 'bg-muted shadow-[inset_0_-2px_0_hsl(var(--ui-foreground))]',
    stat.className
  );

  return stat.href ? (
    <Link href={stat.href} className={className} aria-current={stat.active ? 'true' : undefined}>
      {content}
    </Link>
  ) : (
    <div className={className}>{content}</div>
  );
}

/**
 * Stat bar layout: stats share the full card width. Phones: 2 columns; tablets: one row
 * for up to 4 stats, else 3 columns; desktop: one row. The last stat spans any leftover
 * cells so the bar never shows a gap.
 */
function statBarLayout(count: number) {
  const smSingleRow = count <= 4;
  const container = cn(
    'mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border',
    smSingleRow
      ? 'sm:grid-flow-col sm:auto-cols-fr sm:grid-cols-none'
      : 'sm:grid-cols-3 lg:grid-flow-col lg:auto-cols-fr lg:grid-cols-none'
  );
  const last = cn(
    count % 2 === 1 && 'col-span-2',
    smSingleRow
      ? 'sm:col-span-1'
      : count % 3 === 1
        ? 'sm:col-span-3'
        : count % 3 === 2
          ? 'sm:col-span-2'
          : 'sm:col-span-1',
    'lg:col-span-1'
  );
  return { container, last };
}

/**
 * Page band: always dark (`ok-inverse-surface`, part of the OpsKnight identity), with the
 * eyebrow, title, description, badges, actions and an optional stat strip. All colours
 * come from tokens; the inverse surface pins their light-on-dark values.
 */
export default function DetailHeroBanner({
  breadcrumb,
  breadcrumbSlot,
  tag,
  title,
  subtitle,
  badges,
  icon,
  stats = [],
  statsPlacement: _statsPlacement,
  actions,
  action,
  alert,
  className,
}: DetailHeroBannerProps) {
  const bannerActions = actions || action;
  // One structure on every page: identity + actions on top, stats always in the strip
  // below. `statsPlacement` is accepted for compatibility but no longer changes layout.
  const hasStats = stats.length > 0;

  return (
    <header className={cn('space-y-3', className)}>
      {breadcrumbSlot}
      {!breadcrumbSlot && breadcrumb && (
        <Link
          href={breadcrumb.href}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span>{breadcrumb.label}</span>
          <span className="opacity-40" aria-hidden="true">
            /
          </span>
          <span className="font-medium text-foreground">{breadcrumb.current}</span>
        </Link>
      )}

      <div className="ok-inverse-surface rounded-xl border border-border bg-card px-4 py-3.5 text-card-foreground shadow-sm sm:px-5 sm:py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            {icon && <div className="shrink-0">{icon}</div>}
            <div className="min-w-0 flex-1">
              {(tag || badges) && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {tag && (
                    <p className="text-2xs font-semibold uppercase tracking-widest text-muted-foreground">
                      {tag}
                    </p>
                  )}
                  {badges}
                </div>
              )}
              <h1 className="mt-0.5 text-xl font-extrabold tracking-tight text-foreground sm:text-2xl">
                {title}
              </h1>
              {subtitle && (
                <div className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                  {subtitle}
                </div>
              )}
            </div>
          </div>
          {bannerActions && (
            <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
              {bannerActions}
            </div>
          )}
        </div>

        {hasStats && (
          <div
            aria-label={`${title} summary`}
            role="group"
            className={statBarLayout(stats.length).container}
          >
            {stats.map((stat, idx) => (
              <HeroStat
                key={stat.label || idx}
                stat={stat}
                layoutClass={
                  idx === stats.length - 1 ? statBarLayout(stats.length).last : undefined
                }
              />
            ))}
          </div>
        )}
      </div>

      {alert && <div>{alert}</div>}
    </header>
  );
}

export function DetailHeroBannerSkeleton({
  hasBreadcrumb = false,
  statsCount = 4,
  statsPlacement: _statsPlacement,
  hasActions = true,
  className,
}: {
  hasBreadcrumb?: boolean;
  statsCount?: number;
  /** @deprecated Stats always render in the strip under the title. */
  statsPlacement?: 'inline' | 'bottom';
  hasActions?: boolean;
  className?: string;
}) {
  const bar = statBarLayout(statsCount);
  const statTiles = Array.from({ length: statsCount }).map((_, idx) => (
    <div
      key={idx}
      className={cn('space-y-1.5 bg-card px-3 py-2.5', idx === statsCount - 1 && bar.last)}
    >
      <Skeleton className="h-2.5 w-14 bg-muted" />
      <Skeleton className="h-5 w-10 bg-muted" />
    </div>
  ));

  return (
    <header className={cn('space-y-3', className)} aria-hidden="true">
      {hasBreadcrumb && (
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-20 bg-muted/60" />
          <span className="text-muted-foreground/40">/</span>
          <Skeleton className="h-4 w-28 bg-muted/60" />
        </div>
      )}
      <div className="ok-inverse-surface rounded-xl border border-border bg-card px-4 py-3.5 shadow-sm sm:px-5 sm:py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <Skeleton className="h-10 w-10 shrink-0 rounded-lg bg-muted" />
            <div className="min-w-0 space-y-2">
              <Skeleton className="h-2.5 w-28 bg-muted" />
              <Skeleton className="h-6 w-48 bg-muted sm:w-56" />
              <Skeleton className="h-3.5 w-64 bg-muted/70 sm:w-80" />
            </div>
          </div>
          {hasActions && <Skeleton className="h-9 w-28 shrink-0 rounded-md bg-muted" />}
        </div>
        {statsCount > 0 && <div className={bar.container}>{statTiles}</div>}
      </div>
    </header>
  );
}
