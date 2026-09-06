import { Skeleton } from '@/components/mobile/SkeletonLoader';

const ScheduleSkeleton = () => (
  <div className="flex items-center justify-between gap-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-surface)] p-4">
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <Skeleton width="60%" height="14px" borderRadius="4px" />
      <Skeleton width="45%" height="12px" borderRadius="4px" />
    </div>
    <Skeleton width="16px" height="16px" borderRadius="4px" />
  </div>
);

export default function Loading() {
  return (
    <div className="flex flex-col gap-4 p-4 pb-24">
      <div>
        <Skeleton width="180px" height="22px" borderRadius="6px" />
        <Skeleton className="mt-2" width="90px" height="12px" borderRadius="4px" />
      </div>
      <div className="flex flex-col gap-3">
        <ScheduleSkeleton />
        <ScheduleSkeleton />
        <ScheduleSkeleton />
      </div>
    </div>
  );
}
