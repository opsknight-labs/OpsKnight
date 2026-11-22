import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The KPI tile shared by Analytics and the AIOps overview, so both pages' headline numbers have the same
 * grid, size and type. Callers render `<ul className={KPI_GRID}>` of `<li className={KPI_CARD}>` holding a
 * `<KpiBody>`, and may add their own overlay or footer inside the `li`.
 */
export const KPI_GRID = 'grid grid-cols-2 gap-3 md:grid-cols-4';
export const KPI_CARD = 'min-w-0 rounded-lg border bg-card p-3 shadow-xs sm:p-4';

/** Label and info button, the display numeral, then the delta / secondary line. */
export function KpiBody({
  label,
  info,
  value,
  empty = false,
  valueClassName,
  meta,
}: {
  label: string;
  /** Usually a <MetricInfo>, beside the label. */
  info?: ReactNode;
  value: ReactNode;
  /** No value to show: the numeral is muted. */
  empty?: boolean;
  valueClassName?: string;
  /** Delta badge and secondary text. */
  meta?: ReactNode;
}) {
  return (
    <>
      <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
        <span className="truncate">{label}</span>
        {info}
      </div>
      <p
        className={cn(
          'mt-1 font-display text-2xl font-semibold tabular-nums sm:text-3xl',
          empty && 'text-muted-foreground',
          valueClassName
        )}
      >
        {value}
      </p>
      <div className="mt-1.5 flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {meta}
      </div>
    </>
  );
}

/** Loading placeholder in the shape of a KPI grid, so the layout doesn't jump. */
export function KpiGridSkeleton({ count }: { count: number }) {
  return (
    <ul role="status" aria-label="Loading key metrics" className={KPI_GRID}>
      {Array.from({ length: count }, (_, index) => (
        <li key={index} className="h-26 animate-pulse rounded-lg border bg-card shadow-xs" />
      ))}
    </ul>
  );
}
