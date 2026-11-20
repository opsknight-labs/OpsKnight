import { Card, CardContent } from '@/components/ui/shadcn/card';
import { Skeleton } from '@/components/ui/shadcn/skeleton';
import { DetailHeroBannerSkeleton } from '@/components/ui/DetailHeroBanner';

export default function UsersLoading() {
  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8">
      {/* Centralized Glassmorphic Hero Banner Skeleton */}
      <DetailHeroBannerSkeleton statsCount={4} hasActions={false} />

      {/* Filters Skeleton */}
      <Card className="border-border/70 shadow-2xs">
        <CardContent className="p-4 sm:p-5 space-y-4">
          {/* Quick filter chips */}
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-7 w-20 rounded-md" />
            <Skeleton className="h-7 w-20 rounded-md" />
            <Skeleton className="h-7 w-20 rounded-md" />
            <Skeleton className="h-7 w-20 rounded-md" />
            <Skeleton className="h-7 w-20 rounded-md" />
          </div>
          {/* Filter dropdowns row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Skeleton className="h-9 w-full rounded-lg" />
            <Skeleton className="h-9 w-full rounded-lg" />
            <Skeleton className="h-9 w-full rounded-lg" />
            <Skeleton className="h-9 w-full rounded-lg" />
          </div>
        </CardContent>
      </Card>

      {/* User Directory Skeleton: DirectoryHeader row + DirectoryTable rows */}
      <Card className="border-border/70 shadow-2xs">
        <CardContent className="p-0" role="status" aria-label="Loading users">
          <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-28 rounded-md" />
              <Skeleton className="h-3 w-40 rounded-sm" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-8 w-20 rounded-md" />
              <Skeleton className="h-8 w-36 rounded-md" />
              <Skeleton className="h-8 w-[70px] rounded-md" />
              <Skeleton className="h-8 w-28 rounded-md" />
            </div>
          </div>
          <div className="hidden h-9 items-center border-b border-border sm:flex">
            <div className="w-10 px-4" />
            <div className="flex-1 px-3">
              <Skeleton className="h-2.5 w-10" />
            </div>
            <div className="w-32 px-3">
              <Skeleton className="h-2.5 w-10" />
            </div>
            <div className="hidden w-64 px-3 md:block">
              <Skeleton className="h-2.5 w-12" />
            </div>
            <div className="w-28 px-3">
              <Skeleton className="h-2.5 w-12" />
            </div>
            <div className="hidden w-28 px-3 lg:block">
              <Skeleton className="h-2.5 w-12" />
            </div>
            <div className="w-12" />
          </div>
          <div className="divide-y divide-border">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex h-14 items-center">
                <div className="w-10 shrink-0 px-4">
                  <Skeleton className="h-4 w-4 rounded-sm" />
                </div>
                <div className="flex min-w-0 flex-1 items-center gap-3 px-3">
                  <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-32" />
                    <Skeleton className="h-3 w-48 max-w-full" />
                  </div>
                </div>
                <div className="hidden w-32 px-3 sm:block">
                  <Skeleton className="h-5 w-12 rounded-md" />
                </div>
                <div className="hidden w-64 px-3 md:block">
                  <Skeleton className="h-5 w-28 rounded-md" />
                </div>
                <div className="w-10 px-3 sm:w-28">
                  <Skeleton className="h-2 w-2 rounded-full sm:h-3 sm:w-14 sm:rounded-sm" />
                </div>
                <div className="hidden w-28 px-3 lg:block">
                  <Skeleton className="h-3 w-14" />
                </div>
                <div className="w-12 shrink-0 px-3">
                  <Skeleton className="h-6 w-6 rounded-md" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
