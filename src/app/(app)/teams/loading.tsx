import { Skeleton } from '@/components/ui/shadcn/skeleton';
import { TableRowsSkeleton } from '@/components/patterns';

export default function TeamsLoading() {
  return (
    <main className="mx-auto w-full max-w-[1600px] space-y-6 p-4 md:p-6 animate-pulse">
      {/* Header Banner Skeleton */}
      <div className="rounded-lg bg-primary/20 p-6 md:p-8">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
          <div className="flex items-start gap-4">
            <Skeleton className="h-12 w-12 rounded-xl bg-primary-foreground/20" />
            <div className="space-y-2">
              <Skeleton className="h-3 w-32 bg-primary-foreground/20" />
              <Skeleton className="h-7 w-48 bg-primary-foreground/30" />
              <Skeleton className="h-4 w-72 bg-primary-foreground/20" />
            </div>
          </div>
          <Skeleton className="h-16 w-80 rounded-lg bg-primary-foreground/20" />
        </div>
      </div>

      {/* Dashed Create Button Skeleton */}
      <div className="h-24 w-full rounded-lg border-2 border-dashed border-border/60 bg-muted/20 flex flex-col items-center justify-center gap-2 p-4">
        <Skeleton className="h-8 w-8 rounded-full" />
        <Skeleton className="h-4 w-36" />
      </div>

      {/* Filter bar */}
      <div className="space-y-2.5 rounded-lg border border-border bg-card p-2.5 shadow-sm">
        <div className="flex gap-1.5">
          <Skeleton className="h-7 w-14 rounded-full" />
          <Skeleton className="h-7 w-28 rounded-full" />
          <Skeleton className="h-7 w-28 rounded-full" />
        </div>
        <Skeleton className="h-9 w-full max-w-md rounded-md" />
      </div>

      {/* Directory: header + table (the default view) */}
      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-32" />
          </div>
          <Skeleton className="h-8 w-40 rounded-md" />
        </div>
        <TableRowsSkeleton
          rows={8}
          columns={4}
          label="Loading teams"
          className="rounded-none border-0"
        />
      </div>
    </main>
  );
}
