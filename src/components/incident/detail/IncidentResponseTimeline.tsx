'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertOctagon, ArrowUpRight, Clock, Lock, Route } from 'lucide-react';
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
        : {
            href: `/runbooks/executions/${encodeURIComponent(record.id)}`,
            label: 'Execution',
            page: true,
          };
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

/** Formats structured message templates into human-readable text */
function formatDetailMessage(message: string, timeZone: string): string {
  return message.replace(/\[\[scheduledAt=([^\]]+)\]\]/g, (_match, scheduledAtRaw) => {
    const scheduledAt = new Date(scheduledAtRaw);
    if (Number.isNaN(scheduledAt.getTime())) {
      return scheduledAtRaw;
    }
    return formatDateTime(scheduledAt, timeZone, { format: 'datetime' });
  });
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
      className="min-w-0 space-y-3"
    >
      {/* Compact Header & Filter Bar (Single Unified Row) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2.5 border-b border-border/70">
        <div className="flex items-center gap-2">
          <Route className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
          <h2
            id="incident-response-timeline-heading"
            className="text-xs sm:text-sm font-semibold text-foreground tracking-tight"
          >
            Response activity
          </h2>
          <span className="text-[11px] text-muted-foreground font-medium">
            ({timeline.entries.length})
          </span>
        </div>

        {/* Compact Filter Pills */}
        <div
          className="flex items-center gap-1 flex-wrap"
          role="group"
          aria-label="Filter response lanes"
        >
          <button
            type="button"
            onClick={() => setActive('ALL')}
            aria-pressed={active === 'ALL'}
            className={cn(
              'h-6.5 px-2.5 rounded-md text-xs font-medium transition-all select-none border focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              active === 'ALL'
                ? 'bg-foreground text-background border-foreground shadow-2xs font-semibold'
                : 'bg-background text-muted-foreground border-border/80 hover:text-foreground hover:bg-muted/40'
            )}
          >
            All <span className="tabular-nums font-bold opacity-80">{timeline.entries.length}</span>
          </button>
          {lanes.map(({ lane, count }) => (
            <button
              key={lane}
              type="button"
              onClick={() => setActive(lane)}
              aria-pressed={active === lane}
              aria-label={`${responseLaneLabel(lane)}: ${count} entries`}
              className={cn(
                'inline-flex h-6.5 items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium transition-all select-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                active === lane
                  ? cn(toneChipClass(responseLaneTone(lane)), 'shadow-2xs font-semibold')
                  : count > 0
                    ? 'border-border/80 bg-background text-muted-foreground hover:text-foreground hover:bg-muted/40'
                    : 'border-border/50 bg-muted/15 text-muted-foreground/60 hover:text-muted-foreground'
              )}
            >
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full shrink-0',
                  toneDotClass(responseLaneTone(lane))
                )}
                aria-hidden="true"
              />
              <span>{responseLaneLabel(lane)}</span>
              <span className="tabular-nums text-[10px] opacity-75 font-semibold">{count}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Human intervention required banner */}
      {timeline.humanInterventionRequired && (
        <div
          role="alert"
          className={cn(
            'flex items-start gap-2.5 rounded-lg border p-2.5 text-xs shadow-2xs',
            toneChipClass('critical')
          )}
        >
          <AlertOctagon
            className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400"
            aria-hidden="true"
          />
          <div className="space-y-0.5">
            <span className="font-semibold block text-rose-800 dark:text-rose-200">
              Human intervention required
            </span>
            <span className="text-rose-700/90 dark:text-rose-300/90 leading-relaxed block">
              Automated remediation failed or could not be verified, and this incident&apos;s
              routing decision pages no one. Assign a responder.
            </span>
          </div>
        </div>
      )}

      {/* Restricted notes */}
      {restrictedNotes.map(note => (
        <div
          key={note}
          className="flex items-center gap-2 rounded-lg border border-dashed border-border/80 bg-muted/20 px-3 py-1.5 text-xs text-muted-foreground"
        >
          <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>{note}</span>
        </div>
      ))}

      {timeline.truncated && (
        <p className="text-xs text-muted-foreground">
          Showing the most recent {timeline.entries.length} response entries.
        </p>
      )}

      {/* Main Timeline Entries List */}
      {entries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/80 bg-card py-8 text-center">
          <p className="text-xs text-muted-foreground">
            {active === 'ALL'
              ? 'No response activity has been recorded yet.'
              : `No ${responseLaneLabel(active).toLowerCase()} activity has been recorded.`}
          </p>
        </div>
      ) : (
        <ol
          aria-label="Response timeline entries"
          className="relative min-w-0 space-y-2.5 pl-3 sm:pl-3.5 before:absolute before:bottom-2.5 before:left-[17px] before:top-2.5 before:w-0.5 before:bg-border/60"
        >
          {entries.map(entry => (
            <li
              key={entry.id}
              role="listitem"
              className="relative min-w-0 pl-5 sm:pl-6 group"
              data-lane={entry.lane}
              data-kind={entry.kind}
            >
              {/* Timeline node dot */}
              <div
                className={cn(
                  'absolute -left-0.5 top-2.5 h-2.5 w-2.5 rounded-full ring-3 ring-background transition-transform group-hover:scale-125',
                  toneDotClass(entry.tone)
                )}
                aria-hidden="true"
              />

              {/* Event Card Container */}
              <div className="rounded-lg border border-border/70 bg-card p-2.5 sm:p-3 shadow-2xs hover:border-border transition-all text-card-foreground">
                {/* Header Row: Lane Chip, Title, Timestamp */}
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span
                      className={cn(
                        'inline-flex items-center rounded px-1.5 py-0.2 text-[9.5px] font-bold uppercase tracking-wider',
                        toneChipClass(responseLaneTone(entry.lane))
                      )}
                    >
                      {responseLaneLabel(entry.lane)}
                    </span>
                    <span
                      className={cn(
                        'min-w-0 break-words text-xs font-semibold text-foreground',
                        entry.tone === 'critical' && 'text-rose-700 dark:text-rose-400'
                      )}
                    >
                      {entry.title}
                    </span>
                  </div>

                  <time
                    dateTime={entry.at}
                    className="shrink-0 text-[11px] tabular-nums font-mono text-muted-foreground flex items-center gap-1"
                  >
                    <Clock className="h-3 w-3 text-muted-foreground/60" />
                    <span>{formatDateTime(entry.at, timeZone, { format: 'datetime' })}</span>
                  </time>
                </div>

                {/* Detail description */}
                {entry.detail && (
                  <p className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground leading-relaxed">
                    {formatDetailMessage(entry.detail, timeZone)}
                  </p>
                )}

                {/* Facts Property Inspector Grid */}
                {entry.facts.length > 0 && (
                  <div className="mt-2 rounded bg-muted/30 dark:bg-muted/15 border border-border/50 p-2 text-xs">
                    <dl
                      className={cn(
                        'grid min-w-0 gap-x-3 gap-y-1 text-xs',
                        compact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-[7.5rem_1fr]'
                      )}
                    >
                      {entry.facts.map(item => (
                        <div key={item.label} className="contents">
                          <dt className="text-muted-foreground font-medium text-[11px] uppercase tracking-wide">
                            {item.label}
                          </dt>
                          <dd className="min-w-0 break-words font-mono text-xs font-semibold text-foreground">
                            {item.value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )}

                {/* Record Link Action */}
                {entry.record && (
                  <div className="mt-1.5 pt-1.5 border-t border-border/40 flex items-center">
                    <RecordLink record={entry.record} compact={compact} />
                  </div>
                )}
              </div>
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
    'inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';
  const content = (
    <>
      <span>View {link.label.toLowerCase()}</span>
      <ArrowUpRight className="h-3 w-3 shrink-0" aria-hidden="true" />
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
