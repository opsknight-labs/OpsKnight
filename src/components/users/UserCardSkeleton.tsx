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

export function UserListSkeleton() {
  return (
    <div className="space-y-3">
      <UserCardSkeleton count={5} />
    </div>
  );
}
