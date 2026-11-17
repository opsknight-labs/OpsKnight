import { Skeleton } from '@/components/ui/shadcn/skeleton';
import { DetailHeroBannerSkeleton } from '@/components/ui/DetailHeroBanner';

export default function ActionItemsLoading() {
  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8">
      <DetailHeroBannerSkeleton statsCount={5} statsPlacement="bottom" hasActions={false} />
      <div
        className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3"
        aria-hidden="true"
      >
        <Skeleton className="h-9 w-full max-w-md" />
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-9 w-40" />
      </div>
      <div
        role="status"
        aria-busy="true"
        aria-live="polite"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <span className="sr-only">Loading action items</span>
        {Array.from({ length: 4 }).map((_, column) => (
          <div
            key={column}
            aria-hidden="true"
            className="space-y-2.5 rounded-lg border border-border bg-muted/40 p-3"
          >
            <div className="flex items-center justify-between border-b border-border pb-2.5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-5 w-8 rounded-full" />
            </div>
            {Array.from({ length: 3 - (column % 2) }).map((__, card) => (
              <div key={card} className="space-y-2 rounded-lg border border-border bg-card p-3.5">
                <div className="flex gap-1.5">
                  <Skeleton className="h-5 w-20 rounded-full" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
