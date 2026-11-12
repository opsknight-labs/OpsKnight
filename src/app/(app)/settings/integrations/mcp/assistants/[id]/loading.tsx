/** The detail page's shape while it loads: the header and two sections. */
export default function LoadingMcpAssistant() {
  return (
    <div role="status" aria-live="polite" className="space-y-6">
      <span className="sr-only">Loading assistant…</span>
      <div aria-hidden="true" className="h-28 animate-pulse rounded-xl bg-muted/60" />
      {Array.from({ length: 2 }, (_, section) => (
        <div
          key={section}
          aria-hidden="true"
          className="space-y-3 rounded-xl border border-border p-6"
        >
          <div className="h-5 w-40 animate-pulse rounded bg-muted/60" />
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="h-10 animate-pulse rounded bg-muted/40" />
          ))}
        </div>
      ))}
    </div>
  );
}
