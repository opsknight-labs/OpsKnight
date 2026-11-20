import { Skeleton } from '@/components/ui/shadcn/skeleton';
import { TableRowsSkeleton } from '@/components/patterns';
import { DetailHeroBannerSkeleton } from '@/components/ui/DetailHeroBanner';

export default function SchedulesLoading() {
  return (
    <main className="mx-auto w-full max-w-[1600px] space-y-6 p-4 md:p-6 animate-pulse">
      <DetailHeroBannerSkeleton statsCount={3} hasActions={false} />

      {/* Dashed Create Button Skeleton */}
      <div className="h-24 w-full rounded-lg border-2 border-dashed border-border/60 bg-muted/20 flex flex-col items-center justify-center gap-2 p-4">
        <Skeleton className="h-8 w-8 rounded-full" />
        <Skeleton className="h-4 w-40" />
      </div>

      {/* Directory (full width) */}
      <div>
        {/* Directory Skeleton */}
        <div className="space-y-4">
          {/* Filter bar */}
          <div className="space-y-2.5 rounded-lg border border-border bg-card p-2.5 shadow-sm">
            <div className="flex gap-1.5">
              <Skeleton className="h-7 w-14 rounded-full" />
              <Skeleton className="h-7 w-28 rounded-full" />
            </div>
            <Skeleton className="h-9 w-full max-w-md rounded-md" />
          </div>

          {/* Directory: header row + dense table */}
          <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-8 w-16 rounded-md" />
            </div>
            <TableRowsSkeleton
              rows={6}
              columns={5}
              label="Loading schedules"
              className="rounded-none border-0"
            />
          </div>
        </div>
      </div>
    </main>
  );
}
