import { DirectorySkeleton, FilterBarSkeleton, HeaderSkeleton } from '@/components/patterns';
import { Skeleton } from '@/components/ui/shadcn/skeleton';

/**
 * Mirrors the catalog: header with up to three stats, the health bar card, the filter bar with its
 * eight health chips, and the directory with its seven default columns.
 */
export default function BusinessServicesLoading() {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className="space-y-4 sm:space-y-6">
      <span className="sr-only">Loading business services</span>
      <div aria-hidden="true" className="contents">
        <HeaderSkeleton stats={3} actions />
        <div className="space-y-3 rounded-lg border bg-card p-4 shadow-xs sm:p-5">
          <Skeleton className="h-3 w-48" />
          <Skeleton className="h-2 w-full rounded-full" />
        </div>
        <FilterBarSkeleton chips={8} controls={4} />
        <DirectorySkeleton rows={8} columns={7} />
      </div>
    </div>
  );
}
