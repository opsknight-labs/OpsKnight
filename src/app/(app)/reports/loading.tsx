import { Skeleton } from '@/components/ui/shadcn/skeleton';
import { DetailHeroBannerSkeleton } from '@/components/ui/DetailHeroBanner';
import { CardGridSkeleton } from '@/components/patterns';

export default function ReportsLoading() {
  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8">
      <DetailHeroBannerSkeleton statsCount={3} />
      <div className="space-y-3 rounded-lg border border-border bg-card p-3" aria-hidden="true">
        <div className="flex gap-1.5">
          <Skeleton className="h-8 w-14 rounded-full" />
          <Skeleton className="h-8 w-28 rounded-full" />
          <Skeleton className="h-8 w-28 rounded-full" />
          <Skeleton className="h-8 w-24 rounded-full" />
        </div>
        <Skeleton className="h-9 w-full max-w-md" />
      </div>
      <div className="space-y-4">
        <Skeleton className="h-6 w-40" />
        <CardGridSkeleton cards={6} columns={3} label="Loading dashboards" />
      </div>
    </div>
  );
}
