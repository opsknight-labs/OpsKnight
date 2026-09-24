import { Card, CardContent, CardHeader } from '@/components/ui/shadcn/card';
import { Skeleton } from '@/components/ui/shadcn/skeleton';
import { DetailHeroBannerSkeleton } from '@/components/ui/DetailHeroBanner';

export default function IncidentSlaLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Centralized Glassmorphic Hero Banner Skeleton */}
      <DetailHeroBannerSkeleton statsCount={4} statsPlacement="bottom" hasActions={false} />

      {/* SLA Policy Cards Grid Skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {[1, 2, 3, 4].map(i => (
          <Card key={i} className="border-border/70 shadow-2xs">
            <CardHeader className="p-4 sm:p-5 border-b bg-muted/20">
              <div className="flex items-center justify-between">
                <Skeleton className="h-5 w-28 rounded-md" />
                <Skeleton className="h-6 w-20 rounded-full" />
              </div>
            </CardHeader>
            <CardContent className="p-4 sm:p-5 space-y-3">
              <Skeleton className="h-3.5 w-full rounded" />
              <div className="flex items-center justify-between pt-2">
                <Skeleton className="h-4 w-20 rounded" />
                <Skeleton className="h-4 w-16 rounded" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
