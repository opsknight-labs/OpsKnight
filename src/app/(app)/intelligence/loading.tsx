import { Skeleton } from '@/components/ui/shadcn/skeleton';
import { SectionSkeleton } from '@/components/intelligence/overview/primitives';

export default function IntelligenceOverviewLoading() {
  return (
    <div
      className="mx-auto w-full max-w-7xl space-y-6"
      aria-busy="true"
      aria-label="Loading the AIOps overview"
    >
      <div className="space-y-2">
        <Skeleton className="h-7 w-[220px]" />
        <Skeleton className="h-4 w-3/5" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionSkeleton title="Noise" tiles={6} />
        <SectionSkeleton title="Speed" tiles={5} />
      </div>
    </div>
  );
}
