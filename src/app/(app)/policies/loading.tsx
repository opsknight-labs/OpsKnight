import { Skeleton } from '@/components/ui/shadcn/skeleton';
import { TableRowsSkeleton } from '@/components/patterns/Skeletons';

export default function PoliciesLoading() {
  return (
    <div className="w-full px-3 sm:px-4 md:px-6 lg:px-8 py-4 sm:py-6 space-y-6 animate-pulse">
      {/* Centralized Hero Banner Skeleton */}
      <div className="rounded-2xl bg-primary/20 p-6 sm:p-7">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          <div className="space-y-2">
            <Skeleton className="h-4 w-36 bg-primary-foreground/20 rounded-full" />
            <Skeleton className="h-8 w-64 bg-primary-foreground/30 rounded-lg" />
            <Skeleton className="h-4 w-80 sm:w-96 bg-primary-foreground/20 rounded" />
          </div>
          <div className="grid grid-cols-3 gap-2.5 sm:gap-3.5 w-full lg:w-auto">
            <Skeleton className="h-16 w-24 sm:w-28 rounded-xl bg-primary-foreground/20" />
            <Skeleton className="h-16 w-24 sm:w-28 rounded-xl bg-primary-foreground/20" />
            <Skeleton className="h-16 w-24 sm:w-28 rounded-xl bg-primary-foreground/20" />
          </div>
        </div>
      </div>

      {/* Dashed Expander Skeleton */}
      <div className="h-24 w-full rounded-xl border-2 border-dashed border-ink-200 bg-ink-50/50 flex flex-col items-center justify-center gap-2 p-4">
        <Skeleton className="h-9 w-9 rounded-full bg-ink-200" />
        <Skeleton className="h-4 w-44 bg-ink-200" />
      </div>

      {/* Directory (full width) */}
      <div className="space-y-4">
        {/* Search Toolbar */}
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <Skeleton className="h-8.5 w-full max-w-md rounded-md" />
          <div className="flex gap-1.5">
            <Skeleton className="h-7 w-16 rounded-lg" />
            <Skeleton className="h-7 w-20 rounded-lg" />
            <Skeleton className="h-7 w-24 rounded-lg" />
          </div>
        </div>

        {/* Directory table (the default view) */}
        <TableRowsSkeleton rows={6} columns={5} label="Loading escalation policies" />
      </div>
    </div>
  );
}
