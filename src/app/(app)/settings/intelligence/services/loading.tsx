import { Skeleton } from '@/components/ui/shadcn/skeleton';

export default function IntelligenceServicesLoading() {
  return (
    <div className="space-y-6 animate-pulse" aria-busy="true" aria-label="Loading per-service policies">
      <div className="space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <Skeleton className="h-48 w-full rounded-lg" />
      <Skeleton className="h-64 w-full rounded-lg" />
    </div>
  );
}
