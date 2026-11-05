/** The page's shape while it loads: the header, the section tabs and one section. */
export default function LoadingMcp() {
  return (
    <div role="status" aria-live="polite" className="space-y-6">
      <span className="sr-only">Loading MCP settings…</span>
      <div aria-hidden="true" className="h-40 animate-pulse rounded-xl bg-muted/60" />
      <div aria-hidden="true" className="flex gap-2">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="h-9 w-28 animate-pulse rounded-lg bg-muted/60" />
        ))}
      </div>
      <div aria-hidden="true" className="space-y-3 rounded-xl border border-border p-6">
        <div className="h-5 w-48 animate-pulse rounded bg-muted/60" />
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="h-10 animate-pulse rounded bg-muted/40" />
        ))}
      </div>
    </div>
  );
}
