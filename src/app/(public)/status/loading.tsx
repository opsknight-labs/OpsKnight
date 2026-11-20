import { Skeleton } from '@/components/ui/shadcn/skeleton';

/**
 * Placeholder in the public page's shape: top bar, overall-status card, then service rows with
 * their 90-day bars. Branding is not known yet, so it uses neutral tokens only.
 */
export default function StatusPageLoading() {
  return (
    <main
      role="status"
      aria-busy="true"
      aria-live="polite"
      className="min-h-dvh bg-background text-foreground"
    >
      <span className="sr-only">Loading status page</span>
      <div aria-hidden="true">
        <div className="border-b border-border">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-7">
            <div className="flex items-center gap-3">
              <Skeleton className="size-8 rounded-md" />
              <Skeleton className="h-5 w-40" />
            </div>
            <Skeleton className="h-9 w-28 rounded-md" />
          </div>
        </div>
        <div className="mx-auto max-w-6xl space-y-10 px-4 py-8 sm:px-7">
          <div className="space-y-4 rounded-lg border border-border p-5">
            <Skeleton className="h-5 w-28 rounded-full" />
            <Skeleton className="h-7 w-64 max-w-full" />
            <Skeleton className="h-4 w-80 max-w-full" />
            <div className="grid grid-cols-2 gap-4 border-t border-border pt-4 sm:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-6 w-10" />
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-3">
            <Skeleton className="h-6 w-28" />
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-3 rounded-lg border border-border p-4">
                <div className="flex items-center justify-between gap-4">
                  <Skeleton className="h-4 w-44 max-w-[60%]" />
                  <Skeleton className="h-5 w-24 rounded-full" />
                </div>
                <Skeleton className="h-8 w-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
