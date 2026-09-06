import { Skeleton } from '@/components/ui/shadcn/skeleton';

/**
 * Skeleton that mirrors the actual Analytics V2 layout — KPI grid,
 * insights/trends split, distribution grid, ownership grid, SLA panels.
 * Used as the Suspense fallback so filter changes show an
 * immediate, structurally-matched loading state instead of a
 * generic spinner.
 */
export default function AnalyticsSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Executive Summary — 8 large KPI cards in a 4-col grid */}
      <div className="v2-grid-4 mb-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-6 w-full" />
          </div>
        ))}
      </div>

      {/* Compact KPIs — 12 small cards */}
      <div className="v2-grid-4 mb-8">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-slate-200 bg-white p-3 space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-6 w-14" />
            <Skeleton className="h-2.5 w-20" />
          </div>
        ))}
      </div>

      {/* Insights + trends split */}
      <div className="v2-grid-split mb-8">
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <Skeleton className="h-5 w-40" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-4 flex-1" />
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-[280px] w-full rounded-lg" />
        </div>
      </div>

      {/* Operational grid — 3 cards */}
      <div className="operational-grid mb-8">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-[180px] w-full rounded-lg" />
          </div>
        ))}
      </div>

      {/* Distribution + ownership grids */}
      <div className="distribution-grid mb-8">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
            <Skeleton className="h-5 w-40" />
            {Array.from({ length: 5 }).map((__, j) => (
              <div key={j} className="space-y-1">
                <div className="flex justify-between">
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="h-3 w-10" />
                </div>
                <Skeleton className="h-2 w-full rounded-full" />
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* SLA panels */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 mb-8 space-y-4">
        <Skeleton className="h-5 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-[110px] w-[110px] rounded-full mx-auto" />
              <Skeleton className="h-2 w-full rounded-full" />
            </div>
          ))}
        </div>
      </div>

      {/* Heatmap */}
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <Skeleton className="h-5 w-48 mb-4" />
        <Skeleton className="h-[160px] w-full rounded-lg" />
      </div>
    </div>
  );
}
