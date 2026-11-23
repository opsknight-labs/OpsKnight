'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Layers } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/shadcn/popover';
import CopyButton from '@/components/common/CopyButton';
import RelativeTime from '@/components/patterns/RelativeTime';
import {
  bucketCounts,
  pickBucketMinutes,
  type AlertActivity,
} from '@/lib/incidents/alert-activity';
import { loadAlertActivityAction } from '../alert-actions';
import { formatDateTime } from '@/lib/timezone';
import { cn } from '@/lib/utils';

export type GraphMarkerKind =
  'change' | 'trigger' | 'ack' | 'resolved' | 'escalation' | 'note' | 'runbook' | 'other';

export type GraphMarker = { id: string; at: Date; kind: GraphMarkerKind; label: string };

const MARKER_STYLE: Record<GraphMarkerKind, { dot: string; name: string }> = {
  change: { dot: 'bg-violet-500', name: 'Change' },
  trigger: { dot: 'bg-status-critical', name: 'Triggered' },
  ack: { dot: 'bg-status-ok', name: 'Acknowledged' },
  resolved: { dot: 'bg-status-ok', name: 'Resolved' },
  escalation: { dot: 'bg-status-elevated', name: 'Escalation' },
  note: { dot: 'bg-sky-500', name: 'Note' },
  runbook: { dot: 'bg-teal-500', name: 'Runbook' },
  other: { dot: 'bg-muted-foreground', name: 'Event' },
};

const LEGEND: GraphMarkerKind[] = ['change', 'trigger', 'escalation', 'ack', 'note'];

/** Changes this long before the first signal still widen the graph; older ones fold into "earlier". */
const LEAD_MS = 60 * 60_000;
const MIN_SPAN_MS = 10 * 60_000;
/** Markers closer than this share of the width merge into one, so the lane never turns into a smear. */
const CLUSTER_PCT = 1.6;

/**
 * Inline so it wins over the global coarse-pointer rule (44 px min size and padding on every button), which
 * would turn the graph's 24 px controls into blobs; 24 px still meets WCAG 2.2's minimum target size.
 */
const tight = (padding: string) => ({ minHeight: 0, minWidth: 0, margin: 0, padding });

type Cluster = { pct: number; markers: GraphMarker[]; edge?: 'earlier' | 'later' };

function bucketLabel(minutes: number) {
  return minutes < 60 ? `${minutes} min` : minutes === 60 ? 'hour' : `${minutes / 60} h`;
}

export default function TimelineGraph({
  incidentId,
  alertTotal,
  markers,
  onsetAt,
  endAt,
  open,
  timeZone,
  onJump,
}: {
  incidentId: string;
  /** Alerts on the incident (the page's indexed COUNT); the graph data loads only when this is shown. */
  alertTotal: number;
  markers: GraphMarker[];
  onsetAt: Date;
  /** Resolution time, or when the page was rendered while the incident is open. */
  endAt: Date;
  open: boolean;
  timeZone: string;
  onJump: (rowId: string) => void;
}) {
  const [range, setRange] = useState<'onset' | 'all'>('onset');
  const [alerts, setAlerts] = useState<AlertActivity | null>(null);
  const [loading, setLoading] = useState(alertTotal > 0);
  useEffect(() => {
    if (alertTotal === 0) return;
    let live = true;
    // Aggregated per-minute counts, read only now that the graph is on screen.
    loadAlertActivityAction(incidentId)
      .then(data => live && setAlerts(data))
      .catch(() => live && setAlerts(null))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [incidentId, alertTotal]);
  const view = useMemo(() => {
    const points = (alerts?.buckets ?? []).map(b => ({
      ms: new Date(b.at).getTime(),
      count: b.count,
    }));
    const alertMs = points.map(p => p.ms);
    const onset = new Date(onsetAt).getTime();
    const firstSignal = Math.min(onset, alertMs[0] ?? onset);
    const markerMs = markers.map(m => new Date(m.at).getTime());
    const leadIn = markerMs.filter(t => t >= firstSignal - LEAD_MS && t < firstSignal);
    const start = Math.min(firstSignal, ...leadIn);
    const fullEnd = Math.max(new Date(endAt).getTime(), alertMs.at(-1) ?? 0, start + MIN_SPAN_MS);
    // Onset window: the alert burst and what led up to it, with room after the last alert. Long-running
    // incidents otherwise squeeze the part that explains them into a sliver at the left edge.
    const lastAlert = Math.max(onset, alertMs.at(-1) ?? onset);
    const onsetEnd = Math.min(
      fullEnd,
      Math.max(
        start + MIN_SPAN_MS * 3,
        lastAlert + Math.max(15 * 60_000, (lastAlert - start) * 0.5)
      )
    );
    const zoomable = onsetEnd < fullEnd - (fullEnd - start) * 0.25;
    const end = range === 'onset' && zoomable ? onsetEnd : fullEnd;
    const pad = (end - start) * 0.02;
    const from = start - pad;
    const to = end + pad;
    const span = to - from;
    const pctOf = (t: number) => ((t - from) / span) * 100;

    const bucketMinutes = pickBucketMinutes(end - start);
    const counts = bucketCounts(points, start, end, bucketMinutes);
    const peak = Math.max(0, ...counts);

    const sorted = markers.map(m => ({ m, t: new Date(m.at).getTime() })).sort((a, b) => a.t - b.t);
    const clusters: Cluster[] = [];
    const earlier = sorted.filter(x => x.t < from).map(x => x.m);
    if (earlier.length) clusters.push({ pct: 0, markers: earlier, edge: 'earlier' });
    for (const { m, t } of sorted) {
      if (t < from || t > to) continue;
      const pct = pctOf(t);
      const last = clusters.at(-1);
      if (last && !last.edge && pct - last.pct < CLUSTER_PCT) last.markers.push(m);
      else clusters.push({ pct, markers: [m] });
    }
    const later = sorted.filter(x => x.t > to).map(x => x.m);
    if (later.length) clusters.push({ pct: 100, markers: later, edge: 'later' });

    const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => start + (end - start) * f);
    return {
      from,
      span,
      pctOf,
      bucketMinutes,
      counts,
      peak,
      clusters,
      ticks,
      onsetPct: pctOf(onset),
      zoomable,
      atEnd: end === fullEnd,
    };
  }, [alerts, markers, onsetAt, endAt, range]);

  const bucketMs = view.bucketMinutes * 60_000;
  const tickFormat = view.span > 36 * 3600_000 ? 'short' : 'time';
  const total = alerts?.total ?? alertTotal;

  return (
    <figure
      id="incident-activity"
      className="mb-3 scroll-mt-24 rounded-lg border border-border/70 bg-background px-3 pt-2 pb-1.5"
      aria-label={`Incident activity: ${total} alert${total === 1 ? '' : 's'} and ${markers.length} key events`}
    >
      <figcaption className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="font-semibold text-foreground">Activity</span>
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <span className="h-2 w-2 rounded-xs bg-status-critical/60" aria-hidden />
          alerts per {bucketLabel(view.bucketMinutes)}
        </span>
        <span className="hidden items-center gap-2.5 text-muted-foreground 2xl:inline-flex">
          {LEGEND.map(kind => (
            <span key={kind} className="inline-flex items-center gap-1">
              <span
                className={cn('h-1.5 w-1.5 rounded-full', MARKER_STYLE[kind].dot)}
                aria-hidden
              />
              {MARKER_STYLE[kind].name}
            </span>
          ))}
        </span>
        <span className="ml-auto flex items-center gap-2">
          {view.zoomable && (
            <span
              role="group"
              aria-label="Graph range"
              className="inline-flex h-6 overflow-hidden rounded-md border border-border text-2xs font-medium"
            >
              {(['onset', 'all'] as const).map(option => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={range === option}
                  onClick={() => setRange(option)}
                  style={tight('0 0.5rem')}
                  title={
                    option === 'onset'
                      ? 'Zoom to the alert burst and what led up to it'
                      : 'The whole incident, start to now'
                  }
                  className={cn(
                    'px-2 transition-colors',
                    range === option
                      ? 'bg-foreground text-background'
                      : 'bg-background text-muted-foreground hover:text-foreground'
                  )}
                >
                  {option === 'onset' ? 'Onset' : 'All'}
                </button>
              ))}
            </span>
          )}
          {loading ? (
            <span className="inline-flex h-6 w-36 animate-pulse rounded-md bg-muted" aria-hidden />
          ) : (
            <DedupSummary alerts={alerts} timeZone={timeZone} />
          )}
        </span>
      </figcaption>

      {/* Bars: alert arrivals. The dashed line is the moment the incident was triggered. */}
      <div className="relative h-10" aria-hidden>
        <div className="absolute inset-x-0 bottom-0 h-px bg-border" />
        {view.counts.map((count, i) =>
          count ? (
            <div
              key={i}
              title={`${count} alert${count === 1 ? '' : 's'} from ${formatDateTime(new Date(view.ticks[0] + i * bucketMs), timeZone, { format: 'time' })}`}
              className="absolute bottom-0 px-px"
              style={{
                left: `${view.pctOf(view.ticks[0] + i * bucketMs)}%`,
                width: `${(bucketMs / view.span) * 100}%`,
                height: `${Math.max(12, (count / view.peak) * 100)}%`,
              }}
            >
              <div className="h-full w-full rounded-t-[2px] bg-status-critical/55" />
            </div>
          ) : null
        )}
        <div
          className="absolute -top-0.5 bottom-0 border-l border-dashed border-foreground/35"
          style={{ left: `${view.onsetPct}%` }}
        />
      </div>

      {/* Key events on the same axis; each jumps to its row in the list below. */}
      <div className="relative mt-0.5 h-6">
        {view.clusters.map(cluster => {
          const first = cluster.markers[0];
          const style = MARKER_STYLE[first.kind];
          const many = cluster.markers.length > 1;
          const label = cluster.edge
            ? `${cluster.markers.length} ${cluster.edge} event${many ? 's' : ''}${cluster.edge === 'later' ? ', show the whole incident' : `, first: ${first.label}`}`
            : cluster.markers
                .slice(0, 4)
                .map(
                  m =>
                    `${formatDateTime(new Date(m.at), timeZone, { format: 'time' })} · ${MARKER_STYLE[m.kind].name}: ${m.label}`
                )
                .join('\n') +
              (cluster.markers.length > 4 ? `\n+${cluster.markers.length - 4} more` : '');
          return (
            <button
              key={`${first.id}-${cluster.pct}`}
              type="button"
              // "Later" widens the graph to the whole incident; everything else jumps to its row.
              onClick={() => (cluster.edge === 'later' ? setRange('all') : onJump(first.id))}
              title={label}
              aria-label={label.replace(/\n/g, '; ')}
              className={cn(
                'absolute top-0 flex h-6 min-w-6 items-center justify-center gap-0.5 rounded-full px-1 whitespace-nowrap transition-colors hover:bg-muted focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring',
                cluster.edge === 'earlier'
                  ? 'translate-x-0 text-2xs text-muted-foreground'
                  : cluster.edge === 'later'
                    ? '-translate-x-full text-2xs text-muted-foreground'
                    : '-translate-x-1/2'
              )}
              style={{ left: `${cluster.pct}%`, ...tight('0 0.25rem') }}
            >
              {cluster.edge === 'earlier' ? (
                <>‹ {cluster.markers.length} earlier</>
              ) : cluster.edge === 'later' ? (
                <>{cluster.markers.length} later ›</>
              ) : (
                <>
                  <span className={cn('h-2 w-2 rounded-full', style.dot)} aria-hidden />
                  {many && (
                    <span className="text-2xs font-semibold tabular-nums text-muted-foreground">
                      {cluster.markers.length}
                    </span>
                  )}
                </>
              )}
            </button>
          );
        })}
      </div>

      <div className="relative h-4 text-2xs tabular-nums text-muted-foreground" aria-hidden>
        {view.ticks.map((t, i) => (
          <span
            key={t}
            className={cn(
              'absolute top-0 whitespace-nowrap',
              i % 2 === 1 && 'max-sm:hidden',
              i === 0
                ? 'translate-x-0'
                : i === view.ticks.length - 1
                  ? '-translate-x-full'
                  : '-translate-x-1/2'
            )}
            style={{ left: `${view.pctOf(t)}%` }}
            suppressHydrationWarning
          >
            {i === view.ticks.length - 1 && open && view.atEnd
              ? 'now'
              : formatDateTime(new Date(t), timeZone, { format: tickFormat })}
          </span>
        ))}
      </div>
    </figure>
  );
}

function DedupSummary({ alerts, timeZone }: { alerts: AlertActivity | null; timeZone: string }) {
  if (!alerts || alerts.total === 0) {
    return <span className="text-muted-foreground">No alerts · opened by hand or by API</span>;
  }
  const { total } = alerts;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          style={tight('0 0.5rem')}
          className="group inline-flex h-6 items-center gap-1.5 rounded-md border border-border bg-background px-2 font-medium whitespace-nowrap text-foreground shadow-2xs transition-colors hover:bg-muted/60 data-[state=open]:bg-muted/60"
        >
          <Layers className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          <span className="tabular-nums">
            {total} alert{total === 1 ? '' : 's'} → 1 incident
          </span>
          <ChevronDown
            className="h-3 w-3 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
            aria-hidden
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0 text-xs">
        <div className="border-b border-border/60 px-3 py-2">
          <h2 className="text-xs font-semibold text-foreground">Deduplication</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {total === 1
              ? 'One alert opened this incident; no repeats yet.'
              : `${total} alerts arrived for this incident. The first opened it; the other ${total - 1} were folded in instead of paging again.`}
          </p>
        </div>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 px-3 py-2.5 text-xs">
          <dt className="text-muted-foreground">Dedup key</dt>
          <dd className="flex min-w-0 items-center gap-1">
            {alerts.dedupKey ? (
              <>
                <code className="truncate font-mono text-foreground" title={alerts.dedupKey}>
                  {alerts.dedupKey}
                </code>
                <CopyButton text={alerts.dedupKey} label="Copy dedup key" className="h-5 px-1" />
              </>
            ) : (
              <span className="text-muted-foreground italic">None sent by the source</span>
            )}
          </dd>
          <dt className="text-muted-foreground">Still firing</dt>
          <dd className="tabular-nums text-foreground">
            {alerts.firing} of {total}
          </dd>
          {alerts.fingerprints > 0 && (
            <>
              <dt className="text-muted-foreground">Fingerprints</dt>
              <dd className="tabular-nums text-foreground">{alerts.fingerprints} distinct</dd>
            </>
          )}
          <dt className="text-muted-foreground">Severity</dt>
          <dd className="text-foreground">
            {alerts.severities.map(s => `${s.count} ${s.severity}`).join(' · ')}
          </dd>
          {alerts.firstAt && (
            <>
              <dt className="text-muted-foreground">First seen</dt>
              <dd
                className="text-foreground"
                title={formatDateTime(alerts.firstAt, timeZone, { format: 'datetime' })}
              >
                <RelativeTime date={new Date(alerts.firstAt)} />
              </dd>
            </>
          )}
          {alerts.lastAt && total > 1 && (
            <>
              <dt className="text-muted-foreground">Last seen</dt>
              <dd
                className="text-foreground"
                title={formatDateTime(alerts.lastAt, timeZone, { format: 'datetime' })}
              >
                <RelativeTime date={new Date(alerts.lastAt)} />
              </dd>
            </>
          )}
        </dl>
        <div className="border-t border-border/60 px-3 py-2">
          <a
            href="#incident-alerts"
            className="text-xs font-semibold text-foreground underline-offset-2 hover:underline"
          >
            View each alert and its payload →
          </a>
        </div>
      </PopoverContent>
    </Popover>
  );
}
