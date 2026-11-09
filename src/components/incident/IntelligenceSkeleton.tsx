import { Skeleton } from '@/components/ui/shadcn/skeleton';

export default function IntelligenceSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading intelligence"
      className="min-h-36 space-y-3 rounded-lg border border-border p-4"
    >
      <span className="sr-only">Loading intelligence…</span>
      <Skeleton aria-hidden="true" className="h-4 w-2/3 rounded motion-reduce:animate-none" />
      <Skeleton aria-hidden="true" className="h-3 w-full rounded motion-reduce:animate-none" />
      <Skeleton aria-hidden="true" className="h-3 w-4/5 rounded motion-reduce:animate-none" />
    </div>
  );
}
