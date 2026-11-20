import { Skeleton } from '@/components/ui/shadcn/skeleton';
import { DetailHeroBannerSkeleton } from '@/components/ui/DetailHeroBanner';
import { TableRowsSkeleton } from '@/components/patterns';

/** Loading state for the log pages (audit, events, system logs): header, filter bar, table. */
export default function LogPageSkeleton({
  label,
  statsCount = 1,
  filterCount = 2,
  columns = 5,
}: {
  label: string;
  statsCount?: number;
  filterCount?: number;
  columns?: number;
}) {
  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8">
      <DetailHeroBannerSkeleton statsCount={statsCount} hasActions={false} />
      <div className="space-y-4">
        <div
          aria-hidden="true"
          className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 shadow-sm md:flex-row md:items-end"
        >
          <Skeleton className="h-9 w-full md:max-w-md" />
          {Array.from({ length: filterCount }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-9 w-40" />
            </div>
          ))}
          <Skeleton className="h-9 w-36 md:ml-auto" />
        </div>
        <TableRowsSkeleton rows={8} columns={columns} label={label} />
      </div>
    </div>
  );
}
