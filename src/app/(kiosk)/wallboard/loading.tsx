import { Skeleton } from '@/components/ui/shadcn/skeleton';

/** Always-dark placeholder in the wallboard's layout: header band, incident rows, side rail. */
export default function WallboardLoading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className="dark fixed inset-0 z-[70] flex flex-col gap-4 overflow-hidden bg-[#050507] p-6 text-foreground"
    >
      <span className="sr-only">Loading wallboard</span>
      <div aria-hidden="true" className="contents">
        <div className="flex items-center justify-between rounded-2xl border border-zinc-800 p-6">
          <div className="space-y-3">
            <Skeleton className="h-8 w-72 bg-zinc-800" />
            <Skeleton className="h-4 w-56 bg-zinc-800/70" />
          </div>
          <div className="flex gap-8">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-10 w-16 bg-zinc-800" />
                <Skeleton className="h-3 w-16 bg-zinc-800/70" />
              </div>
            ))}
          </div>
        </div>
        <div className="flex min-h-0 flex-1 gap-4">
          <div className="flex-1 space-y-2 rounded-2xl border border-zinc-800 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full bg-zinc-900" />
            ))}
          </div>
          <div className="hidden w-[340px] space-y-4 lg:block">
            <Skeleton className="h-56 w-full rounded-2xl bg-zinc-900" />
            <Skeleton className="h-32 w-full rounded-2xl bg-zinc-900" />
          </div>
        </div>
      </div>
    </div>
  );
}
