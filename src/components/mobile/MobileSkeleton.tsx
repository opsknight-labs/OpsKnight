'use client';

import { Skeleton } from '@/components/ui/shadcn/skeleton';
import { cn } from '@/lib/utils';

interface MobileSkeletonProps {
  className?: string;
}

/**
 * Base mobile skeleton wrapper for consistent padding/margins if needed
 */
export function MobileSkeleton({ className }: MobileSkeletonProps) {
  return <Skeleton className={cn('bg-slate-200 dark:bg-slate-800', className)} />;
}

export function IncidentListSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-4">
      {/* Header imitation */}
      <div className="flex items-center justify-between mb-2">
        <MobileSkeleton className="h-6 w-32 rounded-md" />
        <MobileSkeleton className="h-4 w-20 rounded-md" />
      </div>

      {/* List items */}
      {[1, 2, 3, 4, 5].map(i => (
        <div
          key={i}
          className="relative flex flex-col gap-2 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
        >
          <div className="flex items-center justify-between">
            <MobileSkeleton className="h-4 w-16 rounded-sm" />
            <MobileSkeleton className="h-4 w-12 rounded-full" />
          </div>
          <MobileSkeleton className="h-5 w-3/4 rounded-md my-1" />
          <div className="flex items-center gap-2 mt-1">
            <MobileSkeleton className="h-3 w-1/4 rounded-sm" />
            <MobileSkeleton className="h-3 w-3 rounded-full" />
            <MobileSkeleton className="h-3 w-16 rounded-sm" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-5 p-4 mt-safe-top">
      {/* Greeting */}
      <div className="space-y-2">
        <MobileSkeleton className="h-8 w-48 rounded-md" />
        <MobileSkeleton className="h-4 w-64 rounded-md" />
      </div>

      {/* On-Call Widget */}
      <div className="w-full h-20 rounded-xl bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 p-4 flex items-center gap-3">
        <MobileSkeleton className="h-10 w-10 rounded-lg" />
        <div className="flex-1 space-y-2">
          <MobileSkeleton className="h-4 w-32 rounded" />
          <MobileSkeleton className="h-3 w-24 rounded" />
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3">
        {[1, 2, 3, 4].map(i => (
          <div
            key={i}
            className="h-24 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 flex flex-col justify-between"
          >
            <MobileSkeleton className="h-8 w-12 rounded" />
            <MobileSkeleton className="h-4 w-16 rounded" />
          </div>
        ))}
      </div>

      {/* Recent Incidents Header */}
      <div className="flex items-center justify-between mt-2">
        <MobileSkeleton className="h-6 w-32 rounded" />
        <MobileSkeleton className="h-4 w-16 rounded" />
      </div>

      {/* Incident Card */}
      <div className="relative flex flex-col gap-2 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <MobileSkeleton className="h-4 w-16 rounded-sm" />
          <MobileSkeleton className="h-4 w-12 rounded-full" />
        </div>
        <MobileSkeleton className="h-5 w-3/4 rounded-md my-1" />
        <div className="flex items-center gap-2 mt-1">
          <MobileSkeleton className="h-3 w-1/4 rounded-sm" />
          <MobileSkeleton className="h-3 w-16 rounded-sm" />
        </div>
      </div>
    </div>
  );
}
