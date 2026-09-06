import { Skeleton } from '@/components/mobile/SkeletonLoader';

const TeamSkeleton = () => (
  <div className="flex items-center gap-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-surface)] p-4">
    <Skeleton width="44px" height="44px" borderRadius="12px" />
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <Skeleton width="50%" height="14px" borderRadius="4px" />
      <Skeleton width="65%" height="12px" borderRadius="4px" />
      <Skeleton width="40%" height="10px" borderRadius="4px" />
    </div>
    <Skeleton width="16px" height="16px" borderRadius="4px" />
  </div>
);

export default function Loading() {
  return (
    <div className="flex flex-col gap-4 p-4 pb-24">
      <div>
        <Skeleton width="130px" height="22px" borderRadius="6px" />
        <Skeleton className="mt-2" width="80px" height="12px" borderRadius="4px" />
      </div>
      <Skeleton width="100%" height="42px" borderRadius="16px" />
      <div className="flex flex-col gap-3">
        <TeamSkeleton />
        <TeamSkeleton />
        <TeamSkeleton />
      </div>
    </div>
  );
}
