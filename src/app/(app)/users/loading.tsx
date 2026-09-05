import { Card, CardContent, CardHeader } from '@/components/ui/shadcn/card';
import { Skeleton } from '@/components/ui/shadcn/skeleton';
import { DetailHeroBannerSkeleton } from '@/components/ui/DetailHeroBanner';
import { UserListSkeleton } from '@/components/users/UserCardSkeleton';

export default function UsersLoading() {
  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8">
      {/* Centralized Glassmorphic Hero Banner Skeleton */}
      <DetailHeroBannerSkeleton statsCount={4} hasActions={true} />

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

      {/* User Directory Skeleton (Full-width responsive 3-column grid) */}
      <Card className="border-border/70 shadow-2xs">
        <CardHeader className="p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <Skeleton className="h-5 w-32 rounded-md" />
              <Skeleton className="h-3.5 w-44 rounded-sm" />
            </div>
            <div className="flex items-center gap-2.5">
              <Skeleton className="h-8 w-36 rounded-lg" />
              <Skeleton className="h-8 w-24 rounded-lg" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4 sm:p-5 pt-0">
          <UserListSkeleton count={6} viewMode="grid" />
        </CardContent>
      </Card>
    </div>
  );
}
