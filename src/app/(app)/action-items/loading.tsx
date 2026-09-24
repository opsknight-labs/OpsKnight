import { Card, CardContent, CardHeader } from '@/components/ui/shadcn/card';
import { Skeleton } from '@/components/ui/shadcn/skeleton';
import { DetailHeroBannerSkeleton } from '@/components/ui/DetailHeroBanner';

export default function ActionItemsLoading() {
  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8 animate-pulse">
      {/* Centralized Glassmorphic Hero Banner Skeleton */}
      <DetailHeroBannerSkeleton statsCount={5} statsPlacement="bottom" hasActions={false} />

      {/* Filter Row Skeleton */}
      <Card className="border-border/70 shadow-2xs">
        <CardContent className="p-4 sm:p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Skeleton className="h-9 w-full rounded-lg" />
            <Skeleton className="h-9 w-full rounded-lg" />
            <Skeleton className="h-9 w-full rounded-lg" />
            <Skeleton className="h-9 w-full rounded-lg" />
          </div>
        </CardContent>
      </Card>

      {/* Action Items List Skeleton */}
      <Card className="border-border/70 shadow-2xs">
        <CardHeader className="p-4 sm:p-5 border-b bg-muted/20">
          <Skeleton className="h-5 w-36 rounded-md" />
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border/60">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="p-4 flex items-center justify-between gap-4">
                <div className="space-y-1.5 flex-1">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-4 w-4 rounded" />
                    <Skeleton className="h-4 w-48 rounded" />
                    <Skeleton className="h-5 w-16 rounded-full" />
                  </div>
                  <Skeleton className="h-3 w-64 rounded" />
                </div>
                <div className="flex items-center gap-2">
                  <Skeleton className="h-6 w-20 rounded-full" />
                  <Skeleton className="h-7 w-20 rounded-md" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
