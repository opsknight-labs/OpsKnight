import type { ReactNode } from 'react';
import { Skeleton } from '@/components/ui/shadcn/skeleton';
import { cn } from '@/lib/utils';

/*
 * Route skeletons for /m, in the shape of the final layout (MobileList vocabulary).
 * Each preset is one `role="status"` region with a single "Loading…" label.
 */

function LoadingRegion({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className={cn('responsive-page space-y-4', className)}
    >
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="contents">
        {children}
      </div>
    </div>
  );
}

const TITLE_WIDTHS = ['w-3/5', 'w-2/3', 'w-1/2', 'w-3/4', 'w-2/5'];
const titleWidth = (i: number) => TITLE_WIDTHS.at(i % TITLE_WIDTHS.length) ?? 'w-1/2';

export function MobileSkeleton({ className }: { className?: string }) {
  return <Skeleton className={className} />;
}

function SearchBarSkeleton({ withFilter = false }: { withFilter?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <Skeleton className="h-11 flex-1 rounded-xl" />
      {withFilter ? <Skeleton className="h-11 w-11 rounded-xl" /> : null}
    </div>
  );
}

function MetaLineSkeleton() {
  return (
    <div className="flex items-center justify-between px-0.5">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-3 w-24" />
    </div>
  );
}

function RowsSkeleton({
  rows,
  leading,
  badges,
}: {
  rows: number;
  leading: boolean;
  badges: boolean;
}) {
  return (
    <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex min-h-14 items-center gap-3 px-3.5 py-3">
          {leading ? <Skeleton className="h-9 w-9 shrink-0 rounded-lg" /> : null}
          <div className="min-w-0 flex-1 space-y-2">
            {badges ? (
              <div className="flex items-center gap-1.5">
                <Skeleton className="h-5 w-20 rounded-full" />
                <Skeleton className="h-5 w-14 rounded-full" />
                <Skeleton className="ml-auto h-3 w-10" />
              </div>
            ) : null}
            <Skeleton className={cn('h-3.5', titleWidth(i))} />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-4 w-4 shrink-0 rounded-sm" />
        </div>
      ))}
    </div>
  );
}

/** List route: optional search, count line and a divided card of rows. */
export function MobileListSkeleton({
  rows = 6,
  search = false,
  leading = true,
  badges = false,
  label = 'Loading list',
}: {
  rows?: number;
  search?: boolean;
  leading?: boolean;
  badges?: boolean;
  label?: string;
}) {
  return (
    <LoadingRegion label={label}>
      <MetaLineSkeleton />
      {search ? <SearchBarSkeleton /> : null}
      <RowsSkeleton rows={rows} leading={leading} badges={badges} />
    </LoadingRegion>
  );
}

/** Detail route: header card with facts, then two sections of rows. */
export function MobileDetailSkeleton({ label = 'Loading details' }: { label?: string }) {
  return (
    <LoadingRegion label={label}>
      <div className="space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="flex items-start gap-3">
          <Skeleton className="h-11 w-11 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-5 w-3/5" />
            <Skeleton className="h-5 w-24 rounded-full" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 border-t border-border pt-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3.5 w-24" />
            </div>
          ))}
        </div>
      </div>
      {Array.from({ length: 2 }).map((_, section) => (
        <div key={section} className="space-y-2">
          <Skeleton className="h-4 w-28" />
          <RowsSkeleton rows={3} leading badges={false} />
        </div>
      ))}
    </LoadingRegion>
  );
}

/** Incident queue: search + filter button, count line, swipe cards. */
export function IncidentListSkeleton() {
  return (
    <LoadingRegion label="Loading incidents">
      <SearchBarSkeleton withFilter />
      <MetaLineSkeleton />
      <div className="flex flex-col gap-2.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="space-y-2 px-3.5 pb-3 pt-3">
              <div className="flex items-center gap-1.5">
                <Skeleton className="h-5 w-20 rounded-full" />
                <Skeleton className="h-5 w-14 rounded-full" />
                <Skeleton className="ml-auto h-3 w-12" />
              </div>
              <Skeleton className={cn('h-4', titleWidth(i))} />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-3.5 py-2">
              <Skeleton className="h-11 w-24 rounded-lg" />
              <Skeleton className="h-11 w-32 rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    </LoadingRegion>
  );
}

/** Incident detail: summary card, disclosures and the bottom action bar footprint. */
export function IncidentDetailSkeleton() {
  return (
    <LoadingRegion label="Loading incident">
      <div className="space-y-3 rounded-xl border border-border bg-card p-3.5">
        <div className="flex items-center justify-between border-b border-border pb-2">
          <Skeleton className="h-4 w-32" />
          <div className="flex gap-1">
            <Skeleton className="h-7 w-12 rounded-md" />
            <Skeleton className="h-7 w-14 rounded-md" />
          </div>
        </div>
        <div className="flex gap-1.5">
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-5 w-14 rounded-full" />
        </div>
        <Skeleton className="h-5 w-4/5" />
        <div className="grid grid-cols-2 gap-4 border-t border-border pt-3">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-8 w-24" />
        </div>
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-11 w-full rounded-xl" />
      ))}
      <div className="space-y-2 rounded-xl border border-border bg-card p-3.5">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
      </div>
    </LoadingRegion>
  );
}

/** Form route (create incident): labelled fields and the action bar. */
export function MobileFormSkeleton({ label = 'Loading form' }: { label?: string }) {
  return (
    <LoadingRegion label={label}>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className={cn('w-full rounded-xl', i === 1 ? 'h-28' : 'h-11')} />
        </div>
      ))}
      <div className="grid grid-cols-2 gap-3 border-t border-border pt-4">
        <Skeleton className="h-11 rounded-xl" />
        <Skeleton className="h-11 rounded-xl" />
      </div>
    </LoadingRegion>
  );
}

/** Home: greeting, on-call strip, attention card, active incidents. */
export function DashboardSkeleton() {
  return (
    <LoadingRegion label="Loading home" className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-3.5 w-56" />
        </div>
        <Skeleton className="h-11 w-32 rounded-xl" />
      </div>
      <div className="flex min-h-14 items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-3">
        <Skeleton className="h-9 w-9 rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-3 w-44" />
        </div>
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-32" />
        <RowsSkeleton rows={2} leading badges={false} />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-36" />
        <RowsSkeleton rows={3} leading={false} badges />
      </div>
    </LoadingRegion>
  );
}

/** Metric routes (analytics, system health): KPI grid plus row cards. */
export function MobileMetricsSkeleton({ label = 'Loading metrics' }: { label?: string }) {
  return (
    <LoadingRegion label={label} className="space-y-5">
      <Skeleton className="h-16 w-full rounded-xl" />
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2 bg-card p-3.5">
            <Skeleton className="h-6 w-12" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-32" />
        <RowsSkeleton rows={3} leading={false} badges />
      </div>
    </LoadingRegion>
  );
}
