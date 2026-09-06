import { Skeleton } from '@/components/mobile/SkeletonLoader';
import MobileCard from '@/components/mobile/MobileCard';

const NotificationSkeleton = () => (
  <MobileCard className="p-4">
    <div className="flex items-start gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[color:var(--bg-secondary)]">
        <Skeleton width="18px" height="18px" borderRadius="6px" />
      </div>
      <div className="flex flex-1 flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <Skeleton width="60%" height="14px" borderRadius="4px" />
          <Skeleton width="12px" height="12px" borderRadius="999px" />
        </div>
        <Skeleton width="90%" height="12px" borderRadius="4px" />
        <div className="flex items-center gap-2">
          <Skeleton width="80px" height="10px" borderRadius="4px" />
          <Skeleton width="40px" height="10px" borderRadius="4px" />
        </div>
      </div>
    </div>
    <div className="mt-3 flex gap-2">
      <Skeleton width="70px" height="24px" borderRadius="999px" />
      <Skeleton width="70px" height="24px" borderRadius="999px" />
    </div>
  </MobileCard>
);

export default function Loading() {
  return (
    <div className="flex flex-col gap-4 p-4 pb-24">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Skeleton width="150px" height="22px" borderRadius="6px" />
          <Skeleton className="mt-2" width="80px" height="12px" borderRadius="4px" />
        </div>
        <Skeleton width="90px" height="28px" borderRadius="8px" />
      </div>
      <div className="flex gap-2">
        <Skeleton width="60px" height="28px" borderRadius="999px" />
        <Skeleton width="80px" height="28px" borderRadius="999px" />
      </div>
      <div className="flex flex-col gap-3">
        <NotificationSkeleton />
        <NotificationSkeleton />
        <NotificationSkeleton />
      </div>
    </div>
  );
}
