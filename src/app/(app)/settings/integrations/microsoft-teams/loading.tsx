import { Card, CardContent, CardHeader } from '@/components/ui/shadcn/card';
import { Skeleton } from '@/components/ui/shadcn/skeleton';
import { DetailHeroBannerSkeleton } from '@/components/ui/DetailHeroBanner';

export default function MicrosoftTeamsLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Centralized Glassmorphic Hero Banner Skeleton */}
      <DetailHeroBannerSkeleton statsCount={5} statsPlacement="bottom" hasActions={false} />

      {/* Tabs navigation skeleton */}
      <div className="flex items-center gap-2 border-b border-border/70 pb-2">
        <Skeleton className="h-8 w-28 rounded-md" />
        <Skeleton className="h-8 w-32 rounded-md" />
        <Skeleton className="h-8 w-36 rounded-md" />
        <Skeleton className="h-8 w-32 rounded-md" />
      </div>

      {/* Primary Card Skeleton */}
      <Card className="border-border/70 shadow-2xs">
        <CardHeader className="p-4 sm:p-5 border-b bg-muted/20">
          <div className="flex items-center justify-between">
            <div className="space-y-1.5">
              <Skeleton className="h-5 w-44 rounded-md" />
              <Skeleton className="h-3.5 w-72 rounded-sm" />
            </div>
            <Skeleton className="h-8 w-24 rounded-lg" />
          </div>
        </CardHeader>
        <CardContent className="p-5 sm:p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Skeleton className="h-3.5 w-24 rounded" />
              <Skeleton className="h-9 w-full rounded-lg" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-3.5 w-24 rounded" />
              <Skeleton className="h-9 w-full rounded-lg" />
            </div>
          </div>
          <div className="space-y-2 pt-2">
            <Skeleton className="h-3.5 w-32 rounded" />
            <Skeleton className="h-20 w-full rounded-lg" />
          </div>
        </CardContent>
      </Card>

      {/* Secondary Status Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="border-border/70 shadow-2xs">
          <CardHeader className="p-4 border-b bg-muted/20">
            <Skeleton className="h-4 w-32 rounded-md" />
          </CardHeader>
          <CardContent className="p-4 space-y-3">
            <Skeleton className="h-4 w-full rounded" />
            <Skeleton className="h-4 w-3/4 rounded" />
            <Skeleton className="h-8 w-28 rounded-lg mt-2" />
          </CardContent>
        </Card>
        <Card className="border-border/70 shadow-2xs">
          <CardHeader className="p-4 border-b bg-muted/20">
            <Skeleton className="h-4 w-32 rounded-md" />
          </CardHeader>
          <CardContent className="p-4 space-y-3">
            <Skeleton className="h-4 w-full rounded" />
            <Skeleton className="h-4 w-3/4 rounded" />
            <Skeleton className="h-8 w-28 rounded-lg mt-2" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
