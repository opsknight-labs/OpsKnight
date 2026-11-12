import type { ReactNode } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
import Skeleton from '@/components/ui/Skeleton';
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
  children,
  className,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      data-overview-section={id}
      className={cn(
        'min-w-0 space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5',
        className
      )}
    >
      <header className="space-y-1">
        <h2 id={`${id}-title`} className="text-base font-semibold tracking-tight">
          {title}
        </h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </header>
      {children}
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
    <div className="min-w-0 space-y-1 rounded-lg border border-border/70 bg-background/60 p-3">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="break-words text-xl font-semibold text-foreground">{value}</dd>
      {delta && (
        <dd
          className={cn(
            'flex items-center gap-1 text-xs font-medium',
            delta.tone === 'good' && 'text-status-ok-deep dark:text-status-ok-soft',
            delta.tone === 'bad' && 'text-status-critical-deep dark:text-status-critical-soft',
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

export function StatGrid({ label, children }: { label: string; children: ReactNode }) {
  return (
    <dl aria-label={label} className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-3">
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
      className="flex items-start gap-2 rounded-lg border border-status-critical-border/40 bg-status-critical-soft p-3 text-sm text-status-critical-deep dark:bg-status-critical/10 dark:text-foreground"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p>{message}</p>
    </div>
  );
}

export function SectionSkeleton({ title, tiles = 3 }: { title: string; tiles?: number }) {
  const muted = { backgroundColor: 'hsl(var(--ui-muted))' };
  return (
    <section
      aria-busy="true"
      aria-label={`Loading ${title}`}
      className="min-w-0 space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5"
    >
      <Skeleton variant="text" width="40%" height={18} style={muted} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {Array.from({ length: tiles }, (_, index) => (
          <Skeleton key={index} variant="rounded" width="100%" height={72} style={muted} />
        ))}
      </div>
      <Skeleton variant="rounded" width="100%" height={96} style={muted} />
    </section>
  );
}

/**
 * Shown when the feature behind a section is off. Only administrators are told how to turn it on;
 * everyone else learns that it is off and whom to ask.
 */
export function FeatureOff({
  title,
  adminHint,
  href,
  canManage,
}: {
  title: string;
  adminHint: string;
  href: string;
  canManage: boolean;
}) {
  return (
    <EmptyState
      size="sm"
      title={title}
      description={canManage ? adminHint : 'Ask an administrator if you would like it turned on.'}
      action={
        canManage ? (
          <Link
            href={href}
            className="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Open settings
          </Link>
        ) : undefined
      }
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
