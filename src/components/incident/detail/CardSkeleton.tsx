/**
 * Placeholder for a streamed incident card: same frame and rough height as the card, so the column does not
 * jump when the data arrives. Purely presentational (no data, no client JS).
 */
export default function CardSkeleton({ title, rows = 3 }: { title: string; rows?: number }) {
  return (
    <div
      aria-hidden
      className="overflow-hidden rounded-xl border border-border/80 bg-background shadow-2xs"
    >
      <div className="border-b border-border/70 bg-muted/20 px-3 py-2 text-xs font-semibold text-muted-foreground">
        {title}
      </div>
      <div className="space-y-2.5 px-3 py-3">
        {Array.from({ length: rows }, (_, i) => (
          <div
            key={i}
            className="h-3 animate-pulse rounded bg-muted motion-reduce:animate-none"
            style={{ width: `${88 - i * 14}%` }}
          />
        ))}
      </div>
    </div>
  );
}
