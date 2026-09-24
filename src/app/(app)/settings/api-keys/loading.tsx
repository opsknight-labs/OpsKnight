import { Card, CardContent, CardHeader } from '@/components/ui/shadcn/card';
import { Skeleton } from '@/components/ui/shadcn/skeleton';
import { DetailHeroBannerSkeleton } from '@/components/ui/DetailHeroBanner';

export default function ApiKeysLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Centralized Glassmorphic Hero Banner Skeleton */}
      <DetailHeroBannerSkeleton statsCount={3} statsPlacement="bottom" hasActions={false} />

      {/* API Keys Table Card Skeleton */}
      <Card className="border-border/70 shadow-2xs">
        <CardHeader className="p-4 sm:p-5 border-b bg-muted/20">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Skeleton className="h-5 w-32 rounded-md" />
              <Skeleton className="h-3.5 w-60 rounded-sm" />
            </div>
            <Skeleton className="h-8 w-28 rounded-lg" />
          </div>
        </CardHeader>
        <CardContent className="p-4 sm:p-5 space-y-4">
          {[1, 2, 3].map(i => (
            <div
              key={i}
              className="flex items-center justify-between p-3 rounded-lg border border-border/60"
            >
              <div className="space-y-1.5 flex-1">
                <Skeleton className="h-4 w-36 rounded" />
                <Skeleton className="h-3 w-48 rounded" />
              </div>
              <Skeleton className="h-8 w-20 rounded-md" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
