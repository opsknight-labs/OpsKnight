export default function Loading() {
  return (
    <div role="status" aria-label="Loading grouping quality" className="animate-pulse space-y-4">
      <div className="h-8 w-48 rounded bg-muted" />
      <div className="h-64 rounded-lg bg-muted" />
    </div>
  );
}
