import Link from 'next/link';
import { RelativeTime, SeverityBadge } from '@/components/patterns';
import { toneClasses } from '@/components/patterns/status-tone';
import { urgencyTone } from '@/lib/design/status-palette';
import type { ImpactTimelineEntry, TimeWindow } from '@/lib/business-services/contract';
import { formatMoney, intervalCostCents } from '@/lib/business-services/impact-cost';
import { cn } from '@/lib/utils';

const SOURCE_LABEL: Record<ImpactTimelineEntry['source'], string> = {
  DIRECT: 'Direct',
  DEPENDENCY: 'Via a dependency',
  NESTED: 'Via a supporting business service',
  MANUAL: 'Marked by a responder',
};

const LIST_LIMIT = 8;

function minutesLabel(minutes: number) {
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${Math.round(minutes % 60)}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/**
 * Impact strip over a window: one bar per impact interval, coloured by incident urgency (excluded ones
 * grey), then the most recent impacts as a list. `showIncidents` off (stakeholders) leaves out titles and
 * links; so does an interval whose incident the engine withheld (null fields): only when and how long.
 */
export default function ImpactTimeline({
  entries,
  window,
  showIncidents,
  now = window.to,
  cost,
}: {
  entries: readonly ImpactTimelineEntry[];
  window: TimeWindow;
  showIncidents: boolean;
  now?: Date;
  /** Revenue rate for the per-incident cost; leave out for readers who must not see money. */
  cost?: { revenuePerHourCents: number | null; currency: string };
}) {
  const from = window.from.getTime();
  const span = Math.max(1, window.to.getTime() - from);
  const counted = entries.filter(entry => !entry.excluded);
  const recent = [...entries]
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
    .slice(0, LIST_LIMIT);
  const days = Math.round(span / 86_400_000);
  const summary = counted.length
    ? `${counted.length} ${counted.length === 1 ? 'impact' : 'impacts'} in the last ${days} days`
    : `No impact in the last ${days} days`;

  return (
    <div className="space-y-4">
      <figure className="space-y-1.5">
        <div
          role="img"
          aria-label={summary}
          className="relative h-8 overflow-hidden rounded-md border bg-muted/50"
        >
          {entries.map((entry, index) => {
            const start = Math.max(entry.startedAt.getTime(), from);
            const end = Math.min((entry.endedAt ?? now).getTime(), window.to.getTime());
            const left = ((start - from) / span) * 100;
            const width = Math.max(((end - start) / span) * 100, 0.6);
            return (
              <span
                key={index}
                className={cn(
                  'absolute inset-y-1 rounded-sm',
                  entry.excluded
                    ? 'bg-ink-300 opacity-60'
                    : toneClasses(urgencyTone(entry.urgency) ?? 'neutral').solid
                )}
                style={{ left: `${left}%`, width: `${width}%` }}
              />
            );
          })}
        </div>
        <figcaption className="flex justify-between text-xs text-muted-foreground tabular-nums">
          <span>{days} days ago</span>
          <span>{summary}</span>
          <span>Now</span>
        </figcaption>
      </figure>

      {recent.length > 0 && (
        <ol className="divide-y divide-border rounded-md border" aria-label="Recent impacts">
          {recent.map((entry, index) => {
            const minutes = ((entry.endedAt ?? now).getTime() - entry.startedAt.getTime()) / 60_000;
            const costCents =
              cost && !entry.excluded
                ? intervalCostCents(entry, cost.revenuePerHourCents, now)
                : null;
            return (
              <li
                key={index}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
              >
                {entry.urgency && <SeverityBadge urgency={entry.urgency} size="xs" />}
                <span className="min-w-0 flex-1 truncate">
                  {showIncidents && entry.incidentId && entry.incidentTitle ? (
                    <Link
                      href={`/incidents/${entry.incidentId}`}
                      className="font-medium text-foreground hover:underline focus-visible:rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {entry.incidentTitle}
                    </Link>
                  ) : (
                    <span className="font-medium text-foreground">Incident</span>
                  )}
                  <span className="text-muted-foreground"> · {SOURCE_LABEL[entry.source]}</span>
                  {entry.excluded && (
                    <span className="text-muted-foreground"> · excluded from uptime</span>
                  )}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  <RelativeTime date={entry.startedAt} /> ·{' '}
                  {entry.endedAt ? minutesLabel(minutes) : 'ongoing'}
                  {costCents !== null && cost && (
                    <span title="Estimated cost of this impact"> · ~{formatMoney(costCents, cost.currency)}</span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
