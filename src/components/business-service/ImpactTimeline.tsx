'use client';
/* eslint-disable security/detect-object-injection -- lookups are keyed by typed enum values (status, source), never request input */

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { RelativeTime, SeverityBadge } from '@/components/patterns';
import { toneClasses } from '@/components/patterns/status-tone';
import { Button } from '@/components/ui/shadcn/button';
import type { ImpactTimelineEntry, TimeWindow } from '@/lib/business-services/contract';
import { formatMoney, intervalCostCents } from '@/lib/business-services/impact-cost';
import { publicStatusForIncidentUrgency } from '@/lib/status-pages/status-presentation';
import { notify } from '@/lib/toast';
import { unmarkImpactAction } from '@/app/(app)/services/business/actions';
import { cn } from '@/lib/utils';
import { BS_STATUS_META } from './HealthBadge';

const SOURCE_LABEL: Record<ImpactTimelineEntry['source'], string> = {
  DIRECT: 'Direct',
  DEPENDENCY: 'Via a dependency',
  NESTED: 'Via a supporting business service',
  MANUAL: 'Marked by a responder',
};

const LIST_LIMIT = 8;
/** Matches the server read (`MAX_TIMELINE`): at this length older intervals were cut. */
export const TIMELINE_CAP = 500;
const DAY = 86_400_000;

function minutesLabel(minutes: number) {
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${Math.round(minutes % 60)}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** Status an interval stands for, by its incident urgency (degraded, partial or major); null if unknown. */
const statusOf = (entry: ImpactTimelineEntry) =>
  entry.urgency ? publicStatusForIncidentUrgency(entry.urgency) : null;

/** Bar height by severity, so the three levels differ by more than colour. */
const HEIGHT: Record<string, string> = {
  DEGRADED: 'inset-y-[10px]',
  PARTIAL_OUTAGE: 'inset-y-[6px]',
  MAJOR_OUTAGE: 'inset-y-[2px]',
};

/** Minutes of (non-excluded) impact per day, oldest first; overlaps in a day count once. */
export function dailyImpactMinutes(
  entries: readonly ImpactTimelineEntry[],
  window: TimeWindow,
  now: Date = window.to
): number[] {
  const days = Math.max(1, Math.round((window.to.getTime() - window.from.getTime()) / DAY));
  const start = window.to.getTime() - days * DAY;
  return Array.from({ length: days }, (_, day) => {
    const from = start + day * DAY;
    const to = from + DAY;
    const clipped = entries
      .filter(entry => !entry.excluded)
      .map(entry => [
        Math.max(entry.startedAt.getTime(), from),
        Math.min((entry.endedAt ?? now).getTime(), to),
      ])
      .filter(([a, b]) => b > a)
      .sort((a, b) => a[0] - b[0]);
    let total = 0;
    let end = from;
    for (const [a, b] of clipped) {
      if (b <= end) continue;
      total += b - Math.max(a, end);
      end = b;
    }
    return total / 60_000;
  });
}

/**
 * Impact strip over a window: one focusable bar per impact interval (colour and height by severity,
 * excluded ones grey), details for the focused or hovered one below the strip, a per-day trend and the
 * most recent impacts as a list. `showIncidents` off (stakeholders) leaves out titles and links.
 */
export default function ImpactTimeline({
  entries,
  window,
  showIncidents,
  now = window.to,
  cost,
  businessServiceId,
  canUnmark = false,
}: {
  entries: readonly ImpactTimelineEntry[];
  window: TimeWindow;
  showIncidents: boolean;
  now?: Date;
  /** Revenue rate for the per-incident cost; leave out for readers who must not see money. */
  cost?: { revenuePerHourCents: number | null; currency: string };
  businessServiceId?: string;
  /** Responders only: shows "Unmark" on manual impacts. */
  canUnmark?: boolean;
}) {
  const from = window.from.getTime();
  const span = Math.max(1, window.to.getTime() - from);
  const ordered = [...entries].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  const [active, setActive] = useState<ImpactTimelineEntry | null>(null);
  const [pending, startTransition] = useTransition();
  const counted = entries.filter(entry => !entry.excluded);
  const recent = [...entries]
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
    .slice(0, LIST_LIMIT);
  const days = Math.round(span / DAY);
  const summary = counted.length
    ? `${counted.length} ${counted.length === 1 ? 'impact' : 'impacts'} in the last ${days} days`
    : `No impact in the last ${days} days`;
  const trend = dailyImpactMinutes(entries, window, now);
  const peak = Math.max(...trend, 1);

  const describe = (entry: ImpactTimelineEntry) => {
    const minutes = ((entry.endedAt ?? now).getTime() - entry.startedAt.getTime()) / 60_000;
    const status = statusOf(entry);
    return [
      status ? BS_STATUS_META[status].label : 'Impact',
      SOURCE_LABEL[entry.source],
      entry.excluded ? 'excluded from uptime' : null,
      `started ${entry.startedAt.toLocaleString()}`,
      entry.endedAt ? `lasted ${minutesLabel(minutes)}` : 'ongoing',
    ]
      .filter(Boolean)
      .join(', ');
  };
  const unmark = (entry: ImpactTimelineEntry) => {
    if (!entry.incidentId || !businessServiceId) return;
    const incidentId = entry.incidentId;
    startTransition(async () => {
      const result = await unmarkImpactAction(incidentId, businessServiceId);
      if (result.ok) {
        notify.success('Impact unmarked');
        setActive(null);
      } else notify.error(result.error);
    });
  };

  const detail = active && (
    <div
      data-testid="impact-detail"
      className="space-y-1 rounded-md border bg-card px-3 py-2 text-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        {active.urgency && <SeverityBadge urgency={active.urgency} size="xs" />}
        <span className="font-medium">
          {showIncidents && active.incidentId && active.incidentTitle ? (
            <Link
              href={`/incidents/${active.incidentId}`}
              className="hover:underline focus-visible:rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            >
              {active.incidentTitle}
            </Link>
          ) : (
            'Incident'
          )}
        </span>
        {canUnmark && active.source === 'MANUAL' && !active.excluded && active.incidentId && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="ml-auto h-7 text-xs"
            disabled={pending}
            onClick={() => unmark(active)}
          >
            Unmark
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground tabular-nums">
        {describe(active)}
        {cost &&
          !active.excluded &&
          cost.revenuePerHourCents != null &&
          intervalCostCents(active, cost.revenuePerHourCents, now) !== null && (
            <>
              {' '}
              · ~
              {formatMoney(
                intervalCostCents(active, cost.revenuePerHourCents, now) ?? 0,
                cost.currency
              )}
            </>
          )}
      </p>
    </div>
  );

  return (
    <div className="space-y-4">
      <figure className="space-y-1.5">
        <div
          role="group"
          aria-label={`${summary}. Each bar is one impact; focus a bar for its details.`}
          onKeyDown={event => event.key === 'Escape' && setActive(null)}
          className="relative h-8 overflow-hidden rounded-md border bg-muted/50"
        >
          {ordered.map((entry, index) => {
            const start = Math.max(entry.startedAt.getTime(), from);
            const end = Math.min((entry.endedAt ?? now).getTime(), window.to.getTime());
            const status = statusOf(entry);
            return (
              <button
                key={index}
                type="button"
                title={describe(entry)}
                aria-label={describe(entry)}
                aria-pressed={active === entry}
                onFocus={() => setActive(entry)}
                onMouseEnter={() => setActive(entry)}
                onClick={() => setActive(entry)}
                // A bar can be a sliver of the strip; the inset and min width keep it hit-able.
                className={cn(
                  'absolute min-w-[6px] rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                  entry.excluded
                    ? 'inset-y-[10px] bg-ink-300 opacity-60'
                    : cn(
                        (status && HEIGHT[status]) || 'inset-y-[10px]',
                        toneClasses(status ? BS_STATUS_META[status].tone : 'neutral').solid
                      )
                )}
                style={{
                  left: `${((start - from) / span) * 100}%`,
                  width: `${Math.max(((end - start) / span) * 100, 0.6)}%`,
                }}
              />
            );
          })}
        </div>
        <figcaption className="flex justify-between text-xs text-muted-foreground tabular-nums">
          <span>{days} days ago</span>
          <span>{summary}</span>
          <span>Now</span>
        </figcaption>
        <ul
          aria-label="Legend"
          className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
        >
          {(['DEGRADED', 'PARTIAL_OUTAGE', 'MAJOR_OUTAGE'] as const).map(status => (
            <li key={status} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className={cn(
                  'inline-block h-2.5 w-2.5 rounded-sm',
                  toneClasses(BS_STATUS_META[status].tone).solid
                )}
              />
              {BS_STATUS_META[status].label}
            </li>
          ))}
          <li className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 rounded-sm bg-ink-300 opacity-60"
            />
            Excluded
          </li>
        </ul>
      </figure>

      {entries.length >= TIMELINE_CAP && (
        <p role="note" className="text-xs text-status-elevated">
          Showing the newest {TIMELINE_CAP} impacts. Older ones in this window are not drawn, though
          uptime figures still count them.
        </p>
      )}

      <div aria-live="polite">{detail}</div>

      {counted.length > 0 && (
        <div
          role="img"
          aria-label={`Impact minutes per day, last ${days} days; busiest day ${Math.round(peak)} minutes`}
          className="flex h-10 items-end gap-px"
        >
          {trend.map((minutes, index) => (
            <span
              key={index}
              className={cn('flex-1 rounded-t-sm', minutes > 0 ? 'bg-status-elevated' : 'bg-muted')}
              style={{ height: `${minutes > 0 ? Math.max((minutes / peak) * 100, 8) : 4}%` }}
            />
          ))}
        </div>
      )}

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
                <span className="min-w-40 flex-1 sm:truncate">
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
                    <span title="Estimated cost of this impact">
                      {' '}
                      · ~{formatMoney(costCents, cost.currency)}
                    </span>
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
