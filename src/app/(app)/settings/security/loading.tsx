import { SettingsFormLoading } from '@/components/settings/feedback/LoadingState';
import { Skeleton } from '@/components/ui/shadcn/skeleton';

export default function SecurityLoading() {
  return (
    <div className="space-y-6">
      {/* Header Skeleton */}
      <div className="space-y-4 pb-6 border-b border-border">
        <Skeleton className="h-4 w-32" /> {/* Back link */}
        <Skeleton className="h-10 w-48" /> {/* Title */}
        <Skeleton className="h-4 w-96" /> {/* Description */}
      </div>

      {/* Summary Grid Skeleton */}
      <div className="grid gap-4 md:grid-cols-3">
        <Skeleton className="h-24 rounded-lg" />
        <Skeleton className="h-24 rounded-lg" />
        <Skeleton className="h-24 rounded-lg" />
      </div>

      {/* Form Skeleton */}
      <SettingsFormLoading sections={2} />
    </div>
  );
}
