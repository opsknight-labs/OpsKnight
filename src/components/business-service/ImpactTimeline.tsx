'use client';
/* eslint-disable security/detect-object-injection -- lookups are keyed by typed enum values (status, source), never request input */

import { useRef, useState, useTransition, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { SeverityBadge } from '@/components/patterns';
import { toneClasses } from '@/components/patterns/status-tone';
import { Button } from '@/components/ui/shadcn/button';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useTimezone } from '@/contexts/TimezoneContext';
import type { BsStatus, ImpactTimelineEntry, TimeWindow } from '@/lib/business-services/contract';
import { formatMoney, intervalCostCents } from '@/lib/business-services/impact-cost';
import { publicStatusForIncidentUrgency } from '@/lib/status-pages/status-presentation';
import { formatDateTime } from '@/lib/timezone';
import { notify } from '@/lib/toast';
import { unmarkImpactAction } from '@/app/(app)/services/business/actions';
import { cn } from '@/lib/utils';
import { BS_STATUS_META } from './HealthBadge';
import { dailyImpactMinutes } from './impact-days';

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
const SEVERITIES = ['DEGRADED', 'PARTIAL_OUTAGE', 'MAJOR_OUTAGE'] as const;
const RANK: Record<string, number> = { DEGRADED: 1, PARTIAL_OUTAGE: 2, MAJOR_OUTAGE: 3 };

function minutesLabel(minutes: number) {
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${Math.round(minutes % 60)}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** Status an interval stands for, by its incident urgency (degraded, partial or major); null if unknown. */
const statusOf = (entry: ImpactTimelineEntry) =>
  entry.urgency ? publicStatusForIncidentUrgency(entry.urgency) : null;

export { dailyImpactMinutes };

const entryKey = (entry: ImpactTimelineEntry) =>
  `${entry.incidentId ?? entry.source}:${entry.source}:${entry.startedAt.getTime()}`;
// Fixed format and zone for tooltips: the UTC reading next to the viewer's local time.
const stamp = (date: Date) => `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

type Day = {
  from: number;
  to: number;
  minutes: number;
  /** Worst severity of a counted interval that day; null for none (or unknown urgency). */
  worst: BsStatus | null;
  entries: ImpactTimelineEntry[];
};

/**
 * Impact over a window as one chart: a column per day (height = minutes of impact, colour = the
 * day's worst severity), day ticks, and one tab stop (arrow keys move between days). Selecting a day
 * lists its impacts below; otherwise the list shows the most recent ones. Times read in the viewer's
 * time zone with UTC in the tooltip. `showIncidents` off (stakeholders) leaves out titles and links.
 */
export default function ImpactTimeline({
  entries,
  window,
  showIncidents,
  now = window.to,
  cost,
  businessServiceId,
  canUnmark = false,
  ranges,
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
  /** Window switch (7/30/90 days): each option's link and whether it is the current one. */
  ranges?: ReadonlyArray<{ days: number; href: string; current: boolean }>;
}) {
  const { userTimeZone } = useTimezone();
  const local = (date: Date) => formatDateTime(date, userTimeZone, { format: 'short' });
  const dayLabel = (ms: number) => formatDateTime(new Date(ms), userTimeZone, { format: 'date' });

  const minutes = dailyImpactMinutes(entries, window, now);
  const start = window.to.getTime() - minutes.length * DAY;
  const days: Day[] = minutes.map((total, index) => {
    const from = start + index * DAY;
    const to = from + DAY;
    const overlapping = entries.filter(
      entry => entry.startedAt.getTime() < to && (entry.endedAt ?? now).getTime() > from
    );
    const worst = overlapping
      .filter(entry => !entry.excluded)
      .map(statusOf)
      .reduce<BsStatus | null>(
        (best, status) => (status && (!best || RANK[status] > RANK[best]) ? status : best),
        null
      );
    return { from, to, minutes: total, worst, entries: overlapping };
  });
  const peak = Math.max(...minutes, 1);
  const counted = entries.filter(entry => !entry.excluded);
  const summary = counted.length
    ? `${counted.length} ${counted.length === 1 ? 'impact' : 'impacts'} in the last ${days.length} days`
    : `No impact in the last ${days.length} days`;
  const tickEvery = days.length <= 7 ? 1 : days.length <= 30 ? 7 : 15;

  const lastImpacted = days.findLastIndex(day => day.entries.length > 0);
  const [selected, setSelected] = useState<number | null>(null);
  const [focusIndex, setFocusIndex] = useState(lastImpacted >= 0 ? lastImpacted : days.length - 1);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const day = selected === null ? null : (days.at(selected) ?? null);

  const move = (event: KeyboardEvent, index: number) => {
    const next =
      event.key === 'ArrowRight'
        ? Math.min(index + 1, days.length - 1)
        : event.key === 'ArrowLeft'
          ? Math.max(index - 1, 0)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? days.length - 1
              : null;
    if (event.key === 'Escape') {
      setSelected(null);
      return;
    }
    if (next === null) return;
    event.preventDefault();
    setFocusIndex(next);
    setSelected(next);
    buttons.current.at(next)?.focus();
  };

  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<ImpactTimelineEntry | null>(null);
  const unmark = (entry: ImpactTimelineEntry) => {
    if (!entry.incidentId || !businessServiceId) return;
    const incidentId = entry.incidentId;
    startTransition(async () => {
      const result = await unmarkImpactAction(incidentId, businessServiceId);
      setConfirming(null);
      if (result.ok) notify.success('Impact unmarked');
      else notify.error(result.error);
    });
  };

  const listed = day
    ? [...day.entries].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
    : [...entries]
        .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
        .slice(0, LIST_LIMIT);

  return (
    <div className="space-y-4">
      {ranges && ranges.length > 0 && (
        <nav aria-label="Impact window" className="flex justify-end">
          <ul className="inline-flex rounded-md border p-0.5 text-xs">
            {ranges.map(range => (
              <li key={range.days}>
                <Link
                  href={range.href}
                  scroll={false}
                  aria-current={range.current ? 'true' : undefined}
                  className={cn(
                    'inline-flex h-7 items-center rounded-sm px-2.5 font-medium tabular-nums transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
                    range.current
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {range.days} days
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <figure className="space-y-1.5">
        <div
          role="group"
          aria-label={`${summary}. One column per day; use the arrow keys to move between days.`}
          className="flex h-24 items-end gap-px rounded-md border bg-muted/30 px-1 pt-2"
        >
          {days.map((entry, index) => {
            const label = entry.minutes
              ? `${dayLabel(entry.from)}: ${minutesLabel(entry.minutes)} of impact${entry.worst ? `, worst ${BS_STATUS_META[entry.worst].label.toLowerCase()}` : ''}`
              : entry.entries.length
                ? `${dayLabel(entry.from)}: excluded impact only`
                : `${dayLabel(entry.from)}: no impact`;
            return (
              <button
                key={entry.from}
                ref={node => {
                  buttons.current[index] = node;
                }}
                type="button"
                tabIndex={index === focusIndex ? 0 : -1}
                aria-label={label}
                aria-pressed={selected === index}
                title={`${label} (${stamp(new Date(entry.from))} to ${stamp(new Date(entry.to))})`}
                onClick={() => {
                  setFocusIndex(index);
                  setSelected(selected === index ? null : index);
                }}
                onKeyDown={event => move(event, index)}
                className={cn(
                  'group relative flex h-full min-w-0 flex-1 items-end rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
                  selected === index && 'bg-muted'
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'block w-full rounded-t-sm transition-opacity group-hover:opacity-80',
                    entry.minutes > 0
                      ? toneClasses(entry.worst ? BS_STATUS_META[entry.worst].tone : 'neutral')
                          .solid
                      : entry.entries.length
                        ? 'bg-muted-foreground/40'
                        : 'bg-border'
                  )}
                  style={{
                    height: `${entry.minutes > 0 ? Math.max((entry.minutes / peak) * 100, 8) : entry.entries.length ? 6 : 2}%`,
                  }}
                />
              </button>
            );
          })}
        </div>
        <div aria-hidden className="relative h-4 text-2xs text-muted-foreground tabular-nums">
          {days.map((entry, index) =>
            (days.length - 1 - index) % tickEvery === 0 ? (
              <span
                key={entry.from}
                className="absolute -translate-x-1/2 whitespace-nowrap"
                style={{ left: `${((index + 0.5) / days.length) * 100}%` }}
              >
                {index === days.length - 1 ? 'Today' : dayLabel(entry.from).replace(/, \d{4}$/, '')}
              </span>
            ) : null
          )}
        </div>
        <figcaption className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="tabular-nums">{summary}</span>
          <ul aria-label="Legend" className="flex flex-wrap gap-x-4 gap-y-1">
            {SEVERITIES.map(status => (
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
                className="inline-block h-2.5 w-2.5 rounded-sm bg-muted-foreground/40"
              />
              Excluded
            </li>
          </ul>
        </figcaption>
      </figure>

      {entries.length >= TIMELINE_CAP && (
        <p role="note" className="text-xs text-status-elevated">
          Showing the newest {TIMELINE_CAP} impacts. Older ones in this window are not drawn, though
          uptime figures still count them.
        </p>
      )}

      <div aria-live="polite" className="space-y-2">
        {day && (
          <div className="flex items-center justify-between gap-2 text-xs">
            <p className="font-medium text-foreground">
              {dayLabel(day.from)}:{' '}
              {day.entries.length
                ? `${day.entries.length} impact${day.entries.length === 1 ? '' : 's'}`
                : 'no impact'}
            </p>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => setSelected(null)}
            >
              Show recent
            </Button>
          </div>
        )}
        {listed.length > 0 && (
          <ol
            data-testid={day ? 'impact-detail' : undefined}
            className="divide-y divide-border rounded-md border"
            aria-label={day ? `Impacts on ${dayLabel(day.from)}` : 'Recent impacts'}
          >
            {listed.map(entry => {
              const duration =
                ((entry.endedAt ?? now).getTime() - entry.startedAt.getTime()) / 60_000;
              const costCents =
                cost && !entry.excluded
                  ? intervalCostCents(entry, cost.revenuePerHourCents, now)
                  : null;
              const status = statusOf(entry);
              return (
                <li
                  key={entryKey(entry)}
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
                    {status && <span className="sr-only"> · {BS_STATUS_META[status].label}</span>}
                    {entry.excluded && (
                      <span className="text-muted-foreground"> · excluded from uptime</span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    <time dateTime={entry.startedAt.toISOString()} title={stamp(entry.startedAt)}>
                      {local(entry.startedAt)}
                    </time>{' '}
                    · {entry.endedAt ? minutesLabel(duration) : 'ongoing'}
                    {costCents !== null && cost && (
                      <span title="Estimated cost of this impact">
                        {' '}
                        · ~{formatMoney(costCents, cost.currency)}
                      </span>
                    )}
                  </span>
                  {canUnmark &&
                    entry.source === 'MANUAL' &&
                    !entry.excluded &&
                    entry.incidentId && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        disabled={pending}
                        onClick={() => setConfirming(entry)}
                      >
                        Unmark
                      </Button>
                    )}
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <ConfirmDialog
        isOpen={confirming !== null}
        variant="warning"
        title="Unmark this impact?"
        message={`${showIncidents && confirming?.incidentTitle ? `"${confirming.incidentTitle}"` : 'This incident'} will stop counting against this business service: every interval it had leaves the uptime and error budget figures. Marking it again later starts a new interval from that moment.`}
        confirmText={pending ? 'Unmarking…' : 'Unmark impact'}
        cancelText="Keep"
        onCancel={() => setConfirming(null)}
        onConfirm={() => confirming && unmark(confirming)}
      />
    </div>
  );
}
