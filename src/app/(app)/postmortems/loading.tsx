import { Skeleton } from '@/components/ui/shadcn/skeleton';
import { DetailHeroBannerSkeleton } from '@/components/ui/DetailHeroBanner';
import { TableRowsSkeleton } from '@/components/patterns';

export default function PostmortemsLoading() {
  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8">
      <DetailHeroBannerSkeleton statsCount={4} statsPlacement="bottom" />
      <div
        className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3"
        aria-hidden="true"
      >
        <Skeleton className="h-9 w-full max-w-md" />
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-9 w-40" />
      </div>
      <TableRowsSkeleton rows={6} columns={6} label="Loading postmortems" />
    </div>
  );
}
