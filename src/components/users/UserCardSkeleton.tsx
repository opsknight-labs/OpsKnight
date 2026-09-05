'use client';

import { Skeleton } from '@/components/ui/shadcn/skeleton';

interface UserCardSkeletonProps {
  count?: number;
}

export function UserCardSkeleton({ count = 1 }: UserCardSkeletonProps) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex items-center justify-between gap-4 p-4 rounded-xl border border-border/70 bg-card/60 animate-pulse"
        >
          {/* Checkbox + Avatar + User info skeleton */}
          <div className="flex items-center gap-3.5 min-w-0 flex-1 pl-1.5">
            <Skeleton className="h-4 w-4 rounded shrink-0" />
            <Skeleton className="h-10 w-10 rounded-full shrink-0" />
            <div className="flex-1 min-w-0 space-y-2">
              <Skeleton className="h-4 w-36 rounded" />
              <Skeleton className="h-3 w-48 rounded" />
            </div>
          </div>

          {/* Badges + Actions skeleton */}
          <div className="flex items-center gap-2.5 shrink-0">
            <Skeleton className="h-6 w-16 rounded-md" />
            <Skeleton className="h-6 w-16 rounded-md" />
            <Skeleton className="h-7 w-7 rounded-md" />
          </div>
        </div>
      ))}
    </>
  );
}

export function UserCardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border border-border/70 bg-card p-4 shadow-2xs space-y-3.5 animate-pulse"
        >
          {/* Header row: Checkbox + Badges + Menu */}
          <div className="flex items-center justify-between gap-2">
            <Skeleton className="h-4 w-4 rounded shrink-0" />
            <div className="flex items-center gap-1.5">
              <Skeleton className="h-5 w-14 rounded-md" />
              <Skeleton className="h-5 w-16 rounded-md" />
              <Skeleton className="h-6 w-6 rounded-md" />
            </div>
          </div>

          {/* User profile row: Avatar + Name + Email */}
          <div className="flex items-start gap-3 pt-1">
            <Skeleton className="h-10 w-10 rounded-full shrink-0" />
            <div className="space-y-1.5 flex-1 min-w-0">
              <Skeleton className="h-4 w-32 rounded" />
              <Skeleton className="h-3 w-40 rounded" />
            </div>
          </div>

          {/* Tags */}
          <div className="flex items-center gap-1.5 pt-1">
            <Skeleton className="h-5 w-20 rounded-md" />
            <Skeleton className="h-5 w-24 rounded-md" />
          </div>

          {/* Footer row */}
          <div className="flex items-center justify-between pt-2 border-t border-border/60">
            <Skeleton className="h-3.5 w-20 rounded" />
            <Skeleton className="h-3.5 w-24 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function UserListSkeleton({
  count = 6,
  viewMode = 'grid',
}: {
  count?: number;
  viewMode?: 'grid' | 'list';
} = {}) {
  if (viewMode === 'grid') {
    return <UserCardGridSkeleton count={count} />;
  }
  return (
    <div className="space-y-2.5">
      <UserCardSkeleton count={count} />
    </div>
  );
}
