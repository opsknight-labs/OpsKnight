'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertOctagon, ArrowUpRight, Lock, Route } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/timezone';
import {
  responseLaneLabel,
  responseLaneTone,
  toneChipClass,
  toneDotClass,
  type ResponseLane,
} from '@/lib/incidents/response-presentation';
import type {
  IncidentResponseTimeline as Timeline,
  ResponseTimelineRecord,
} from '@/lib/incidents/response-timeline';

const RESTRICTED_NOTE = new Map<ResponseLane, string>([
  ['ROUTING', 'Routing decision details require automation read access.'],
  ['RECOVERY', 'Runbook recovery outcomes require Runbook read access.'],
]);

/** In-page anchors switch the incident tab; execution records open their own page on desktop. */
export function recordLink(
  record: ResponseTimelineRecord,
  compact: boolean
): { href: string; label: string; page: boolean } {
  const anchor = (id: string) => `#${encodeURIComponent(id)}`;
  switch (record.type) {
    case 'DECISION':
      return { href: '#automation-decision', label: 'Routing decision', page: false };
    case 'ESCALATION_STEP':
      return { href: '#escalation-health', label: 'Escalation step', page: false };
    case 'EXECUTION':
      return compact
        ? { href: anchor(`runbook-execution-${record.id}`), label: 'Execution', page: false }
        : { href: `/runbooks/executions/${encodeURIComponent(record.id)}`, label: 'Execution', page: true };
    case 'APPROVAL':
      return {
        href: anchor(`runbook-execution-${record.executionId}`),
        label: 'Approval',
        page: false,
      };
    case 'SUGGESTION':
      return { href: anchor(`runbook-suggestion-${record.id}`), label: 'Suggestion', page: false };
    case 'NOTIFICATION':
      return { href: anchor(`timeline-notif-${record.id}`), label: 'Notification', page: false };
    case 'EVENT':
      return { href: anchor(`timeline-${record.id}`), label: 'Timeline event', page: false };
  }
}

export default function IncidentResponseTimeline({
  timeline,
  timeZone,
  compact = false,
}: {
  timeline: Timeline | null;
  timeZone: string;
  compact?: boolean;
}) {
  const [active, setActive] = useState<ResponseLane | 'ALL'>('ALL');
  const lanes = useMemo(() => (timeline?.lanes ?? []).filter(state => state.visible), [timeline]);
  const entries = useMemo(
    () => (timeline?.entries ?? []).filter(entry => active === 'ALL' || entry.lane === active),
    [timeline, active]
  );

  if (!timeline) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        The response timeline is unavailable for this incident.
      </p>
    );
  }
  const restrictedNotes = lanes
    .filter(state => state.restricted && (active === 'ALL' || active === state.lane))
    .map(state => RESTRICTED_NOTE.get(state.lane))
    .filter((note): note is string => !!note);

  return (
    <section
      id="response-activity"
      aria-labelledby="incident-response-timeline-heading"
      className="min-w-0 space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id="incident-response-timeline-heading"
          className="flex items-center gap-2 text-sm font-semibold tracking-tight"
        >
          <Route className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Response activity
        </h2>
        <span className="text-xs text-muted-foreground">
          Routing → paging → remediation → verification → recovery
        </span>
      </div>

      {timeline.humanInterventionRequired && (
        <div
          role="alert"
          className={cn(
            'flex items-start gap-2 rounded-lg border px-3 py-2 text-xs',
            toneChipClass('critical')
          )}
        >
          <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            <strong className="font-semibold">Human intervention required.</strong> Automated
            remediation failed or could not be verified, and this incident&apos;s routing decision
            pages no one. Assign a responder.
          </span>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter response lanes">
        <button
          type="button"
          onClick={() => setActive('ALL')}
          aria-pressed={active === 'ALL'}
          className={cn(
            'min-h-8 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            active === 'ALL'
              ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900'
              : 'border-border bg-background text-muted-foreground hover:text-foreground'
          )}
        >
          All <span className="tabular-nums">{timeline.entries.length}</span>
        </button>
        {lanes.map(({ lane, count }) => (
          <button
            key={lane}
            type="button"
            onClick={() => setActive(lane)}
            aria-pressed={active === lane}
            aria-label={`${responseLaneLabel(lane)}: ${count} entries`}
            className={cn(
              'inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active === lane
                ? toneChipClass(responseLaneTone(lane))
                : 'border-border bg-background text-muted-foreground hover:text-foreground'
            )}
          >
            <span
              className={cn('h-2 w-2 rounded-full', toneDotClass(responseLaneTone(lane)))}
              aria-hidden="true"
            />
            {responseLaneLabel(lane)}
            <span className="tabular-nums opacity-80" aria-hidden="true">
              {count}
            </span>
          </button>
        ))}
      </div>

      {restrictedNotes.map(note => (
        <p
          key={note}
          className="flex items-center gap-1.5 rounded-md border border-dashed px-2.5 py-1.5 text-xs text-muted-foreground"
        >
          <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {note}
        </p>
      ))}
      {timeline.truncated && (
        <p className="text-xs text-muted-foreground">
          Showing the most recent {timeline.entries.length} response entries.
        </p>
      )}

      {entries.length === 0 ? (
        <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
          {active === 'ALL'
            ? 'No response activity has been recorded yet.'
            : `No ${responseLaneLabel(active).toLowerCase()} activity has been recorded.`}
        </p>
      ) : (
        <ol aria-label="Response timeline entries" className="relative min-w-0 space-y-3">
          {entries.map(entry => (
            <li
              key={entry.id}
              className="relative min-w-0 border-l-2 border-border pb-1 pl-4 last:pb-0"
              data-lane={entry.lane}
              data-kind={entry.kind}
            >
              <span
                className={cn(
                  'absolute -left-[7px] top-1.5 h-3 w-3 rounded-full ring-4 ring-card',
                  toneDotClass(entry.tone)
                )}
                aria-hidden="true"
              />
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span
                  className={cn(
                    'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                    toneChipClass(responseLaneTone(entry.lane))
                  )}
                >
                  {responseLaneLabel(entry.lane)}
                </span>
                <span
                  className={cn(
                    'min-w-0 break-words text-sm font-semibold',
                    entry.tone === 'critical' && 'text-rose-700 dark:text-rose-300'
                  )}
                >
                  {entry.title}
                </span>
                <time
                  dateTime={entry.at}
                  className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground"
                >
                  {formatDateTime(entry.at, timeZone, { format: 'datetime' })}
                </time>
              </div>
              {entry.detail && (
                <p className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">
                  {entry.detail}
                </p>
              )}
              {entry.facts.length > 0 && (
                <dl
                  className={cn(
                    'mt-2 grid min-w-0 gap-x-4 gap-y-1 text-xs',
                    compact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-[9rem_1fr]'
                  )}
                >
                  {entry.facts.map(item => (
                    <div key={item.label} className="contents">
                      <dt className="text-muted-foreground">{item.label}</dt>
                      <dd className="min-w-0 break-words font-medium">{item.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {entry.record && <RecordLink record={entry.record} compact={compact} />}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function RecordLink({ record, compact }: { record: ResponseTimelineRecord; compact: boolean }) {
  const link = recordLink(record, compact);
  const className =
    'mt-1.5 inline-flex min-h-8 items-center gap-1 rounded text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  const content = (
    <>
      View {link.label.toLowerCase()}
      <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
    </>
  );
  return link.page ? (
    <Link href={link.href} className={className} data-record-type={record.type}>
      {content}
    </Link>
  ) : (
    <a href={link.href} className={className} data-record-type={record.type}>
      {content}
    </a>
  );
}
