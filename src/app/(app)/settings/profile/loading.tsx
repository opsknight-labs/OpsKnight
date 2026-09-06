import { SettingsFormLoading } from '@/components/settings/feedback/LoadingState';
import { Skeleton } from '@/components/ui/shadcn/skeleton';

export default function ProfileLoading() {
  return (
    <div className="space-y-6">
      {/* Header Skeleton */}
      <div className="space-y-4 pb-6 border-b border-border">
        <Skeleton className="h-4 w-32" /> {/* Back link */}
        <Skeleton className="h-10 w-48" /> {/* Title */}
        <Skeleton className="h-4 w-96" /> {/* Description */}
      </div>

      {/* Form Skeleton */}
      <SettingsFormLoading sections={2} />
    </div>
  );
}
