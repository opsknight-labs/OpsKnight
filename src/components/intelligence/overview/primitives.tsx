import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  Minus,
  PowerOff,
  Settings2,
} from 'lucide-react';
import EmptyState from '@/components/patterns/EmptyState';
import { toneClasses } from '@/components/patterns/status-tone';
import { Button } from '@/components/ui/shadcn/button';
import { Skeleton } from '@/components/ui/shadcn/skeleton';
import { cn } from '@/lib/utils';

/**
 * Building blocks shared by the AIOps overview sections. They are plain server-renderable components:
 * no client JavaScript is shipped for any of them.
 *
 * Chart colour follows the dataviz emphasis form: one accent hue for the selected window and a gray for
 * context, validated in both modes (light #4f46e5 / #64748b, dark #6366f1 / #64748b). Text never wears
 * the series colour.
 */
export const OVERVIEW_CHART_VARS =
  '[--overview-accent:#4f46e5] [--overview-context:#64748b] dark:[--overview-accent:#6366f1]';

export function OverviewSection({
  id,
  title,
  description,
  icon,
  children,
  footer,
  className,
  drilldown,
}: {
  id: string;
  title: string;
  /** One line on what the card shows. */
  description?: ReactNode;
  /** A rendered lucide icon, drawn in the card's icon tile. */
  icon?: ReactNode;
  children: ReactNode;
  /** Muted note under the body (caveats, how the numbers are counted). */
  footer?: ReactNode;
  className?: string;
  /** Where the full list behind this section lives. */
  drilldown?: { href: string; label: string };
}) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      data-overview-section={id}
      className={cn(
        'flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm',
        className
      )}
    >
      <header className="flex items-start gap-3 border-b border-border px-4 py-3 sm:px-5">
        {icon && (
          <span
            aria-hidden="true"
            className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground ring-1 ring-inset ring-border [&_svg]:h-4 [&_svg]:w-4"
          >
            {icon}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h2
            id={`${id}-title`}
            className="font-display text-base font-semibold tracking-tight text-foreground"
          >
            {title}
          </h2>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {drilldown && (
          <Link
            href={drilldown.href}
            data-overview-drilldown={id}
            className="-my-1 inline-flex min-h-11 shrink-0 items-center gap-1 rounded-md px-1 text-xs font-medium text-muted-foreground underline-offset-4 transition-colors duration-150 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9"
          >
            {drilldown.label}
            <ArrowUpRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          </Link>
        )}
      </header>
      <div className="flex-1 space-y-4 p-4 sm:p-5">{children}</div>
      {footer && (
        <footer className="border-t border-border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground sm:px-5">
          {footer}
        </footer>
      )}
    </section>
  );
}

export type DeltaTone = 'good' | 'bad' | 'neutral';

export interface StatDelta {
  /** Signed text, e.g. "-12% vs previous 7d". */
  text: string;
  direction: 'up' | 'down' | 'flat';
  tone: DeltaTone;
}

/** Placeholder for a value that does not exist yet; the tile's hint says why. */
export const NO_VALUE = '—';

/**
 * One cell of a stat strip, styled like the header band's stats: micro-label, tabular value, then the
 * delta and a one-line hint. A "—" value is muted, and its hint carries the reason.
 */
export function StatTile({
  label,
  value,
  hint,
  delta,
}: {
  label: string;
  value: string;
  hint?: ReactNode;
  delta?: StatDelta | null;
}) {
  const Icon =
    delta?.direction === 'up' ? ArrowUpRight : delta?.direction === 'down' ? ArrowDownRight : Minus;
  return (
    <div className="min-w-0 flex-[1_1_9rem] space-y-0.5 bg-card px-3 py-2.5">
      <dt className="text-balance text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd
        className={cn(
          'break-words text-xl font-semibold tabular-nums',
          value === NO_VALUE ? 'text-muted-foreground' : 'text-foreground'
        )}
      >
        {value}
      </dd>
      {delta && (
        <dd
          className={cn(
            'flex items-center gap-1 text-xs font-medium tabular-nums',
            delta.tone === 'good' && toneClasses('ok').text,
            delta.tone === 'bad' && toneClasses('critical').text,
            delta.tone === 'neutral' && 'text-muted-foreground'
          )}
        >
          <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            {delta.text}
            {delta.tone !== 'neutral' && (
              <span className="sr-only">{delta.tone === 'good' ? ' (better)' : ' (worse)'}</span>
            )}
          </span>
        </dd>
      )}
      {hint && <dd className="text-xs text-muted-foreground">{hint}</dd>}
    </div>
  );
}

/** A hairline-divided strip of `StatTile`s that wraps; tiles grow to fill each row, so no gaps show. */
export function StatGrid({ label, children }: { label: string; children: ReactNode }) {
  return (
    <dl
      aria-label={label}
      className="flex flex-wrap gap-px overflow-hidden rounded-lg border border-border bg-border"
    >
      {children}
    </dl>
  );
}

/**
 * Ranked horizontal bars, largest first, one hue. The numbers are printed beside every bar, so the list
 * is its own table view; the bar itself is decorative.
 */
export function RankedBars({
  label,
  items,
  format = value => value.toLocaleString('en-US'),
}: {
  label: string;
  items: Array<{ key: string; label: string; detail?: string; value: number }>;
  format?: (value: number) => string;
}) {
  const max = Math.max(1, ...items.map(item => item.value));
  return (
    <ul aria-label={label} className={cn('space-y-2', OVERVIEW_CHART_VARS)}>
      {items.map(item => (
        <li key={item.key} className="space-y-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">
              {item.label}
              {item.detail && (
                <span className="ml-1.5 text-xs text-muted-foreground">{item.detail}</span>
              )}
            </span>
            <span className="shrink-0 tabular-nums font-medium">{format(item.value)}</span>
          </div>
          <div aria-hidden="true" className="h-2 w-full">
            <div
              className="h-2 rounded-r bg-[var(--overview-accent)]"
              style={{ width: `${Math.max(2, (item.value / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function SectionError({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2 rounded-lg border p-3 text-sm',
        toneClasses('critical').soft
      )}
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p>{message}</p>
    </div>
  );
}

/** Loading card in the shape of `OverviewSection`: header, a stat strip and a body block. */
export function SectionSkeleton({ title, tiles = 3 }: { title: string; tiles?: number }) {
  return (
    <section
      aria-busy="true"
      aria-label={`Loading ${title}`}
      className="min-w-0 overflow-hidden rounded-lg border border-border bg-card shadow-sm"
    >
      <div className="flex items-start gap-3 border-b border-border px-4 py-3 sm:px-5">
        <Skeleton className="h-8 w-8 shrink-0 rounded-md" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      </div>
      <div className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap gap-px overflow-hidden rounded-lg border border-border bg-border">
          {Array.from({ length: tiles }, (_, index) => (
            <div key={index} className="flex-[1_1_9rem] space-y-1.5 bg-card px-3 py-2.5">
              <Skeleton className="h-2.5 w-16" />
              <Skeleton className="h-6 w-12" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))}
        </div>
        <Skeleton className="h-24 w-full" />
      </div>
    </section>
  );
}

/**
 * Shown when the feature behind a section (or the whole page) is off. Administrators get one sentence on
 * what it does and a button to the settings that turn it on; everyone else learns that it is off and whom
 * to ask, with no button, since they cannot open those settings. `banner` is the compact page-wide
 * callout under the header; `panel` sits inside a card.
 */
export function FeatureOff({
  title,
  adminHint,
  href,
  canManage,
  actionLabel = 'Turn on in settings',
  icon = <PowerOff aria-hidden="true" />,
  variant = 'panel',
}: {
  title: string;
  adminHint: string;
  href: string;
  canManage: boolean;
  actionLabel?: string;
  /** A rendered icon element. */
  icon?: ReactNode;
  variant?: 'panel' | 'banner';
}) {
  const description = canManage
    ? adminHint
    : 'Ask an administrator if you would like it turned on.';
  const action = canManage ? (
    <Button
      asChild
      size="sm"
      variant={variant === 'banner' ? 'default' : 'outline'}
      className="h-11 shrink-0 sm:h-9"
    >
      <Link href={href}>
        <Settings2 className="h-4 w-4" aria-hidden="true" />
        {actionLabel}
      </Link>
    </Button>
  ) : undefined;

  if (variant === 'banner')
    return (
      <section
        aria-label={title}
        data-feature-off="banner"
        className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-sm sm:flex-row sm:items-center"
      >
        <span
          aria-hidden="true"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground ring-1 ring-inset ring-border [&_svg]:h-4 [&_svg]:w-4"
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        </div>
        {action}
      </section>
    );

  return (
    <EmptyState
      size="sm"
      icon={icon}
      title={title}
      description={description}
      primaryAction={action}
    />
  );
}

export const actionLinkClass =
  'inline-flex min-h-11 items-center rounded-md border border-border px-3 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9';

/** Signed relative change between two values, with tone by whether lower is better. */
export function relativeDelta(
  current: number | null,
  previous: number | null,
  options: { lowerIsBetter: boolean; period: string }
): StatDelta | null {
  if (current === null || previous === null) return null;
  if (previous === 0) {
    if (current === 0)
      return {
        text: `No change vs previous ${options.period}`,
        direction: 'flat',
        tone: 'neutral',
      };
    return null;
  }
  const change = (current - previous) / previous;
  const rounded = Math.round(change * 100);
  if (rounded === 0)
    return { text: `No change vs previous ${options.period}`, direction: 'flat', tone: 'neutral' };
  const direction = rounded > 0 ? 'up' : 'down';
  const better = options.lowerIsBetter ? rounded < 0 : rounded > 0;
  return {
    text: `${rounded > 0 ? '+' : '−'}${Math.abs(rounded)}% vs previous ${options.period}`,
    direction,
    tone: better ? 'good' : 'bad',
  };
}
