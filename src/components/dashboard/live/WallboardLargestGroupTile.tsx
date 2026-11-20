import Link from 'next/link';
import { Layers } from 'lucide-react';
import type { WallboardLargestGroup } from '@/lib/intelligence/surfaces/dashboard-pulse';

/**
 * Wallboard tile naming the open parent incident with the most grouped incidents under it, so a room
 * can see at a glance where a storm has been folded together. Shown next to the noise tile; the server
 * passes no group when none is open, and then nothing renders.
 */
export default function WallboardLargestGroupTile({
  group,
}: {
  group: WallboardLargestGroup | null;
}) {
  if (!group) return null;
  return (
    <section
      aria-labelledby="wallboard-largest-group-heading"
      data-testid="wallboard-largest-group-tile"
      className="rounded-xl border border-border bg-card p-3.5 text-card-foreground"
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-status-shift/15 text-status-shift">
          <Layers className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        <h2 id="wallboard-largest-group-heading" className="text-sm font-semibold">
          Largest open group
        </h2>
        <span className="ml-auto text-2xs text-muted-foreground">now</span>
      </div>
      <div className="flex items-end justify-between gap-3">
        <p className="min-w-0 text-sm">
          <Link
            href={`/incidents/${encodeURIComponent(group.parentId)}`}
            className="line-clamp-2 break-words font-medium underline-offset-2 hover:underline"
          >
            {group.parentTitle}
          </Link>
          <span className="mt-0.5 block truncate text-2xs text-muted-foreground">
            {group.parentRef}
            {group.serviceName ? ` · ${group.serviceName}` : ''}
          </span>
        </p>
        <p className="shrink-0 text-right">
          <span className="block text-xl font-semibold tabular-nums text-foreground">
            {new Intl.NumberFormat('en-US').format(group.childCount)}
          </span>
          <span className="block text-2xs font-medium uppercase tracking-wide text-muted-foreground">
            grouped incident{group.childCount === 1 ? '' : 's'}
          </span>
        </p>
      </div>
    </section>
  );
}
