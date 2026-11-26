import { HeaderSkeleton } from '@/components/patterns';
import { Skeleton } from '@/components/ui/shadcn/skeleton';
import { KPI_GRID } from '@/components/analytics/KpiCard';

const card = 'rounded-lg border bg-card p-4 shadow-xs sm:p-5';

/**
 * Mirrors the overview: header with four stats, the tab strip, then incidents, KPIs and the impact
 * chart in the main column beside the details panel.
 */
export default function BusinessServiceLoading() {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className="space-y-4 sm:space-y-6">
      <span className="sr-only">Loading the business service</span>
      <div aria-hidden="true" className="contents">
        <HeaderSkeleton stats={4} actions breadcrumb />
        <div className="flex gap-2 border-b pb-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-8 w-24 rounded-md" />
          ))}
        </div>
        <div className="grid items-start gap-4 sm:gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="min-w-0 space-y-4 sm:space-y-6">
            <div className={`${card} space-y-3`}>
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
            <div className={KPI_GRID}>
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-24 rounded-lg" />
              ))}
            </div>
            <div className={`${card} space-y-3`}>
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-24 w-full" />
            </div>
          </div>
          <div className={`${card} space-y-3`}>
            <Skeleton className="h-4 w-20" />
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-8 w-full" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
