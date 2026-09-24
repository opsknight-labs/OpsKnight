import { Card, CardContent, CardHeader } from '@/components/ui/shadcn/card';
import { Skeleton } from '@/components/ui/shadcn/skeleton';
import { DetailHeroBannerSkeleton } from '@/components/ui/DetailHeroBanner';

export default function SystemSettingsLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Centralized Glassmorphic Hero Banner Skeleton */}
      <DetailHeroBannerSkeleton statsCount={4} statsPlacement="bottom" hasActions={false} />

      {/* Tabs navigation skeleton */}
      <div className="flex items-center gap-2 border-b border-border/70 pb-2">
        <Skeleton className="h-8 w-28 rounded-md" />
        <Skeleton className="h-8 w-32 rounded-md" />
        <Skeleton className="h-8 w-36 rounded-md" />
      </div>

      {/* Primary Settings Card Skeleton */}
      <Card className="border-border/70 shadow-2xs">
        <CardHeader className="p-4 sm:p-5 border-b bg-muted/20">
          <div className="space-y-1.5">
            <Skeleton className="h-5 w-40 rounded-md" />
            <Skeleton className="h-3.5 w-64 rounded-sm" />
          </div>
        </CardHeader>
        <CardContent className="p-5 sm:p-6 space-y-4">
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-28 rounded" />
            <Skeleton className="h-9 w-full rounded-lg" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-32 rounded" />
            <Skeleton className="h-9 w-full rounded-lg" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
