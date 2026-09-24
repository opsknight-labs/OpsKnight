import { Card, CardContent, CardHeader } from '@/components/ui/shadcn/card';
import { Skeleton } from '@/components/ui/shadcn/skeleton';
import { DetailHeroBannerSkeleton } from '@/components/ui/DetailHeroBanner';

export default function ReportsLoading() {
  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8 animate-pulse">
      {/* Centralized Glassmorphic Hero Banner Skeleton */}
      <DetailHeroBannerSkeleton statsCount={4} statsPlacement="bottom" hasActions={true} />

      {/* Reports Grid Skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[1, 2, 3, 4, 5, 6].map(i => (
          <Card key={i} className="border-border/70 shadow-2xs">
            <CardHeader className="p-4 sm:p-5 border-b bg-muted/20">
              <div className="flex items-center justify-between">
                <Skeleton className="h-5 w-32 rounded-md" />
                <Skeleton className="h-6 w-16 rounded-full" />
              </div>
            </CardHeader>
            <CardContent className="p-4 sm:p-5 space-y-3">
              <Skeleton className="h-3.5 w-full rounded" />
              <Skeleton className="h-3.5 w-2/3 rounded" />
              <div className="pt-2 flex items-center justify-between">
                <Skeleton className="h-3 w-20 rounded" />
                <Skeleton className="h-7 w-20 rounded-md" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
