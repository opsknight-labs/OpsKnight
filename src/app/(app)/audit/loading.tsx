import { Card, CardContent, CardHeader } from '@/components/ui/shadcn/card';
import { Skeleton } from '@/components/ui/shadcn/skeleton';
import { DetailHeroBannerSkeleton } from '@/components/ui/DetailHeroBanner';

export default function AuditLoading() {
  return (
    <main className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8 animate-pulse">
      {/* Centralized Glassmorphic Hero Banner Skeleton */}
      <DetailHeroBannerSkeleton statsCount={4} hasActions={false} />

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

      {/* Audit Log Table Card Skeleton */}
      <Card className="border-border/70 shadow-2xs">
        <CardHeader className="p-4 sm:p-5 border-b bg-muted/20">
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-36 rounded-md" />
            <Skeleton className="h-8 w-28 rounded-lg" />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border/60">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="p-4 flex items-center justify-between gap-4">
                <div className="space-y-1.5 flex-1">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-5 w-24 rounded-full" />
                    <Skeleton className="h-4 w-40 rounded" />
                  </div>
                  <Skeleton className="h-3 w-56 rounded" />
                </div>
                <Skeleton className="h-4 w-28 rounded" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
