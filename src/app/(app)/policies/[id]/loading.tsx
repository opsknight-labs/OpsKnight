import { Card } from '@/components/ui/shadcn/card';
import { Skeleton } from '@/components/ui/shadcn/skeleton';

export default function PolicyDetailLoading() {
  return (
    <div className="w-full px-3 sm:px-4 md:px-6 lg:px-8 py-4 sm:py-6 space-y-6 animate-pulse">
      {/* Back Button / Breadcrumb Skeleton */}
      <Skeleton className="h-4 w-48 rounded" />

      {/* Hero Header Skeleton */}
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

      {/* Tab Navigation Skeleton */}
      <div className="grid grid-cols-4 gap-2 p-1.5 rounded-xl border bg-card/90">
        <Skeleton className="h-9 rounded-lg" />
        <Skeleton className="h-9 rounded-lg" />
        <Skeleton className="h-9 rounded-lg" />
        <Skeleton className="h-9 rounded-lg" />
      </div>

      {/* Tab Content Container Skeleton */}
      <Card className="border-slate-200/80 bg-white p-6 space-y-4">
        <div className="flex items-center justify-between border-b pb-4">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-8 w-28 rounded-lg" />
        </div>

        <div className="space-y-3 pt-2">
          {[1, 2, 3].map(i => (
            <div
              key={i}
              className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 flex items-center justify-between gap-4"
            >
              <div className="flex items-center gap-3">
                <Skeleton className="h-7 w-7 rounded-full" />
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-48" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Skeleton className="h-6 w-16 rounded" />
                <Skeleton className="h-8 w-8 rounded" />
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
