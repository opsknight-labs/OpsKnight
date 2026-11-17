import { Skeleton } from '@/components/ui/shadcn/skeleton';
import { DetailHeroBannerSkeleton } from '@/components/ui/DetailHeroBanner';
import { CardGridSkeleton } from '@/components/patterns';

export default function PoliciesLoading() {
  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8">
      <DetailHeroBannerSkeleton statsCount={3} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
        <div className="space-y-4 lg:col-span-3">
          <div className="space-y-3 rounded-lg border border-border bg-card p-3" aria-hidden="true">
            <div className="flex gap-1.5">
              <Skeleton className="h-8 w-16 rounded-full" />
              <Skeleton className="h-8 w-20 rounded-full" />
              <Skeleton className="h-8 w-24 rounded-full" />
            </div>
            <Skeleton className="h-9 w-full max-w-md" />
          </div>
          <CardGridSkeleton cards={4} columns={2} label="Loading escalation policies" />
        </div>
        <div className="space-y-4" aria-hidden="true">
          <Skeleton className="h-44 w-full rounded-lg" />
          <Skeleton className="h-36 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}
