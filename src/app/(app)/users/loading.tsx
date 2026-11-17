import { Skeleton } from '@/components/ui/shadcn/skeleton';
import { DetailHeroBannerSkeleton } from '@/components/ui/DetailHeroBanner';
import { CardGridSkeleton } from '@/components/patterns';

export default function UsersLoading() {
  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8">
      <DetailHeroBannerSkeleton statsCount={4} />
      <div className="space-y-3 rounded-lg border border-border bg-card p-3" aria-hidden="true">
        <div className="flex gap-1.5">
          <Skeleton className="h-8 w-16 rounded-full" />
          <Skeleton className="h-8 w-20 rounded-full" />
          <Skeleton className="h-8 w-20 rounded-full" />
          <Skeleton className="h-8 w-20 rounded-full" />
        </div>
        <div className="flex flex-wrap gap-3">
          <Skeleton className="h-9 w-full max-w-md" />
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-9 w-40" />
        </div>
      </div>
      <CardGridSkeleton cards={6} columns={3} label="Loading users" />
    </div>
  );
}
