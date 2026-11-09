import Skeleton from '@/components/ui/Skeleton';
import { SectionSkeleton } from '@/components/intelligence/overview/primitives';

const muted = { backgroundColor: 'hsl(var(--ui-muted))' };

export default function IntelligenceOverviewLoading() {
  return (
    <div
      className="mx-auto w-full max-w-7xl space-y-6"
      aria-busy="true"
      aria-label="Loading the AIOps overview"
    >
      <div className="space-y-2">
        <Skeleton variant="text" width={220} height={28} style={muted} />
        <Skeleton variant="text" width="60%" height={16} style={muted} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionSkeleton title="Noise" tiles={6} />
        <SectionSkeleton title="Speed" tiles={5} />
      </div>
    </div>
  );
}
