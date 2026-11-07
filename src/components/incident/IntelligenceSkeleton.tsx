export default function IntelligenceSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading intelligence"
      className="min-h-36 space-y-3 rounded-lg border border-border p-4"
    >
      <span className="sr-only">Loading intelligence…</span>
      <div aria-hidden="true" className="h-4 w-2/3 animate-pulse rounded bg-muted" />
      <div aria-hidden="true" className="h-3 w-full animate-pulse rounded bg-muted" />
      <div aria-hidden="true" className="h-3 w-4/5 animate-pulse rounded bg-muted" />
    </div>
  );
}
