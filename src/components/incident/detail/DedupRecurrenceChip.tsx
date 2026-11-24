import Link from 'next/link';
import { Layers } from 'lucide-react';

const HOUR_MS = 3_600_000;
/** Inline so it beats the global coarse-pointer rule (44px min size + padding on every link); the chip is the target. */
const TIGHT = { minHeight: 0, minWidth: 0, padding: 0, margin: 0 } as const;
const DAY_MS = 24 * HOUR_MS;

/** "first in 41 days" / "again after 3 h" / "first time": how long since this dedup key last opened an incident. */
export function recurrenceLabel(createdAt: Date, previousAt: Date | null): string {
  if (!previousAt) return 'first time';
  const gap = createdAt.getTime() - previousAt.getTime();
  if (gap >= DAY_MS) {
    const days = Math.floor(gap / DAY_MS);
    return `first in ${days} day${days === 1 ? '' : 's'}`;
  }
  if (gap >= HOUR_MS) return `again after ${Math.floor(gap / HOUR_MS)} h`;
  return `again after ${Math.max(1, Math.floor(gap / 60_000))} min`;
}

/**
 * Title-card summary of deduplication: how many alerts folded into this incident (opens the activity graph
 * and its dedup details) and how long since the same dedup key last opened an incident (opens that one).
 */
export default function DedupRecurrenceChip({
  alertTotal,
  hasDedupKey,
  createdAt,
  previous,
  routePrefix,
}: {
  alertTotal: number;
  hasDedupKey: boolean;
  createdAt: Date;
  previous: { id: string; title: string; createdAt: Date } | null;
  /** '' on desktop, '/m' on the mobile app. */
  routePrefix: string;
}) {
  if (alertTotal === 0 && !hasDedupKey) return null;
  return (
    <span className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-xs text-muted-foreground shadow-2xs">
      <Layers className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {alertTotal > 0 && (
        <a
          href="#incident-activity"
          style={TIGHT}
          className="font-medium tabular-nums text-foreground hover:underline"
          title="Alerts deduplicated into this incident: open the activity graph and dedup details"
        >
          {alertTotal} alert{alertTotal === 1 ? '' : 's'}
        </a>
      )}
      {hasDedupKey && (
        <>
          {alertTotal > 0 && <span aria-hidden>·</span>}
          {previous ? (
            <Link
              href={`${routePrefix}/incidents/${previous.id}`}
              style={TIGHT}
              className="hover:text-foreground hover:underline"
              title={`Last incident on this dedup key: “${previous.title}”, ${previous.createdAt.toUTCString()}`}
            >
              {recurrenceLabel(createdAt, previous.createdAt)}
            </Link>
          ) : (
            <span title="No earlier incident you can see was opened on this dedup key">
              first time
            </span>
          )}
        </>
      )}
    </span>
  );
}
