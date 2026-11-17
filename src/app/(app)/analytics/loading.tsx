import { Skeleton } from '@/components/ui/shadcn/skeleton';
import { DetailHeroBannerSkeleton } from '@/components/ui/DetailHeroBanner';
import AnalyticsSkeleton from '@/components/analytics/AnalyticsSkeleton';

export default function AnalyticsLoading() {
  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8">
      <DetailHeroBannerSkeleton statsCount={0} />
      <div
        className="flex flex-wrap items-end gap-2.5 rounded-lg border border-border bg-card p-3"
        aria-hidden="true"
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-9 w-40" />
          </div>
        ))}
      </div>
      <div className="[zoom:0.8]">
        <AnalyticsSkeleton />
      </div>
    </div>
  );
}
