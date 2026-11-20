import { Skeleton } from '@/components/ui/shadcn/skeleton';
import { TableRowsSkeleton } from '@/components/patterns';

export default function ServicesLoading() {
  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8">
      {/* Hero banner */}
      <div className="flex flex-col justify-between gap-5 rounded-xl bg-primary/20 p-6 lg:flex-row lg:items-center">
        <div className="flex items-start gap-4">
          <Skeleton className="h-12 w-12 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-3 w-36" />
            <Skeleton className="h-7 w-40" />
            <Skeleton className="h-4 w-80" />
          </div>
        </div>
        <Skeleton className="h-16 w-full max-w-md rounded-lg" />
      </div>

      {/* Create row */}
      <Skeleton className="h-14 w-full rounded-lg" />

      {/* Filter bar */}
      <div className="space-y-2.5 rounded-lg border border-border bg-card p-2.5 shadow-sm">
        <div className="flex gap-1.5">
          <Skeleton className="h-7 w-24 rounded-full" />
          <Skeleton className="h-7 w-24 rounded-full" />
          <Skeleton className="h-7 w-24 rounded-full" />
        </div>
        <Skeleton className="h-9 w-full max-w-md rounded-md" />
      </div>

      {/* Directory: header row + dense table */}
      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-28" />
          </div>
          <Skeleton className="h-8 w-48 rounded-md" />
        </div>
        <TableRowsSkeleton
          rows={10}
          columns={6}
          label="Loading services"
          className="rounded-none border-0"
        />
      </div>
    </div>
  );
}
