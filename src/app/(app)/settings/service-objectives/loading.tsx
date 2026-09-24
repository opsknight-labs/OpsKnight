import { Card, CardContent, CardHeader } from '@/components/ui/shadcn/card';
import { Skeleton } from '@/components/ui/shadcn/skeleton';
import { DetailHeroBannerSkeleton } from '@/components/ui/DetailHeroBanner';

export default function ServiceObjectivesLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Centralized Glassmorphic Hero Banner Skeleton */}
      <DetailHeroBannerSkeleton statsCount={4} statsPlacement="bottom" hasActions={false} />

      {/* Service Objectives Card Skeleton */}
      <Card className="border-border/70 shadow-2xs">
        <CardHeader className="p-4 sm:p-5 border-b bg-muted/20">
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-40 rounded-md" />
            <Skeleton className="h-8 w-28 rounded-lg" />
          </div>
        </CardHeader>
        <CardContent className="p-5 space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="p-4 rounded-xl border border-border/60 space-y-3">
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-32 rounded" />
                <Skeleton className="h-6 w-20 rounded-full" />
              </div>
              <Skeleton className="h-3.5 w-full rounded" />
              <div className="flex items-center gap-4 pt-1">
                <Skeleton className="h-4 w-24 rounded" />
                <Skeleton className="h-4 w-24 rounded" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
