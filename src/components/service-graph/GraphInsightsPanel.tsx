'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { History, Loader2, ShieldAlert, Undo2, GitCompareArrows } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { InlineNotice } from '@/components/ui/InlineNotice';
import { cn } from '@/lib/utils';
import {
  diffGraphAction,
  findSpofAction,
  getGraphAtAction,
  getGraphTimelineAction,
} from '@/app/(app)/services/graph/actions';
import {
  clampMoment,
  DAY_MS,
  TIME_TRAVEL_DAYS,
  toLocalInput,
  type GraphDiff,
  type GraphSnapshot,
  type SpofReport,
} from './insights';
import GraphHealthBadge from './GraphHealthBadge';

export type InsightTab = 'time' | 'changes' | 'spof' | null;

const SINCE_OPTIONS = [
  { days: 1, label: '24 hours' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
] as const;
/** The slider moves a day at a time; the date-time field above it picks an exact hour. */
const DAYS = TIME_TRAVEL_DAYS;
type Timeline = { days: number; incidents: number[]; changes: number[] };
const tabClass = (active: boolean) =>
  cn(
    'inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
    active
      ? 'border-primary bg-primary/10 text-foreground'
      : 'bg-background text-ink-600 hover:text-foreground'
  );

type Props = {
  /** `svc:<id>` / `bs:<id>` of the current focus, so insights match what is on screen. */
  focus: string | null;
  hops: number;
  /** The viewer may see suggested edges (not stakeholders). */
  seesSuggestions: boolean;
  /** The moment being viewed; null = live. Driven by the explorer so the banner and the panel agree. */
  at: Date | null;
  onTravel: (snapshot: GraphSnapshot | null, at: Date | null) => void;
  onDiff: (diff: GraphDiff | null) => void;
  onSpof: (report: SpofReport | null) => void;
  onShowSuggested: () => void;
  onSelectService: (serviceId: string) => void;
};

/** Time travel, "what changed" and single points of failure, one panel at a time. */
export default function GraphInsightsPanel({
  focus,
  hops,
  seesSuggestions,
  at,
  onTravel,
  onDiff,
  onSpof,
  onShowSuggested,
  onSelectService,
}: Props) {
  const [tab, setTab] = useState<InsightTab>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sinceDays, setSinceDays] = useState<number>(7);
  const [diff, setDiff] = useState<GraphDiff | null>(null);
  const [spof, setSpof] = useState<SpofReport | null>(null);
  const [slider, setSlider] = useState(DAYS);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [picked, setPicked] = useState('');
  const request = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const scope = { ...(focus ? { focus, hops } : {}) };

  // Opening or closing a panel adds or removes its overlay on the graph.
  useEffect(() => {
    if (tab !== 'changes') onDiff(null);
    if (tab !== 'spof') onSpof(null);
    if (tab !== 'time' && at) onTravel(null, null);
    // Only the tab drives this; the callbacks are stable setters in the explorer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const run = useCallback(
    async <T,>(job: () => Promise<{ ok: true; data: T } | { ok: false; message: string }>) => {
      const mine = ++request.current;
      setLoading(true);
      setError(null);
      const result = await job().catch(() => ({
        ok: false as const,
        message: 'Unable to load. Try again.',
      }));
      if (mine !== request.current) return null;
      setLoading(false);
      if (!result.ok) {
        setError(result.message);
        return null;
      }
      return result.data;
    },
    []
  );

  const loadDiff = useCallback(
    async (days: number) => {
      const data = await run(() =>
        diffGraphAction({ since: new Date(Date.now() - days * DAY_MS).toISOString(), ...scope })
      );
      setDiff(data);
      onDiff(data);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run, focus, hops]
  );
  const loadSpof = useCallback(async () => {
    const data = await run(() => findSpofAction({ ...scope }));
    setSpof(data);
    onSpof(data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, focus, hops]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs local state with the prop/open transition; cannot be derived during render
    if (tab === 'changes') void loadDiff(sinceDays);
    if (tab === 'spof') void loadSpof();
  }, [tab, sinceDays, loadDiff, loadSpof]);

  const travel = (moment: Date | null) => {
    clearTimeout(timer.current);
    if (!moment) {
      request.current++;
      setLoading(false);
      setSlider(DAYS);
      setPicked('');
      onTravel(null, null);
      return;
    }
    const at = clampMoment(moment);
    setPicked(toLocalInput(at));
    setSlider(Math.round(DAYS - (Date.now() - at.getTime()) / DAY_MS));
    timer.current = setTimeout(async () => {
      const snapshot = await run(() => getGraphAtAction({ at: at.toISOString(), ...scope }));
      if (snapshot) onTravel(snapshot, at);
    }, 350);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  // The banner's "Back to now" lives in the explorer; keep the controls in step with it.
  useEffect(() => {
    if (!at) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs local state with the prop/open transition; cannot be derived during render
      setSlider(DAYS);
      setPicked('');
    }
  }, [at]);

  // Tick marks for the slider: incidents opened and dependency changes per day. Decorative, so a
  // failure leaves the slider without ticks rather than showing an error.
  useEffect(() => {
    if (tab !== 'time' || timeline) return;
    let alive = true;
    getGraphTimelineAction({ ...scope })
      .catch(() => null)
      .then(result => {
        if (alive && result?.ok) setTimeline(result.data);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scope is focus + hops
  }, [tab, timeline, focus, hops]);
  const dayCounts = (value: number) => {
    const ago = DAYS - value;
    return {
      incidents: timeline?.incidents.at(ago) ?? 0,
      changes: timeline?.changes.at(ago) ?? 0,
    };
  };

  // Fixed when the panel mounts; the server clamps anyway.
  const [{ min, max }] = useState(() => ({
    min: toLocalInput(new Date(Date.now() - TIME_TRAVEL_DAYS * DAY_MS)),
    max: toLocalInput(new Date()),
  }));
  const total = diff
    ? diff.addedDependencies.length +
      diff.removedDependencies.length +
      diff.newlySuggestedDependencies.length +
      diff.serviceStatusChanges.length +
      diff.businessServiceStatusChanges.length
    : 0;

  return (
    <section aria-label="Graph insights" className="space-y-3 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-pressed={tab === 'time'}
          className={tabClass(tab === 'time')}
          onClick={() => setTab(tab === 'time' ? null : 'time')}
        >
          <History className="h-3.5 w-3.5" aria-hidden="true" /> Time travel
        </button>
        <button
          type="button"
          aria-pressed={tab === 'changes'}
          className={tabClass(tab === 'changes')}
          onClick={() => setTab(tab === 'changes' ? null : 'changes')}
        >
          <GitCompareArrows className="h-3.5 w-3.5" aria-hidden="true" /> Changes
        </button>
        <button
          type="button"
          aria-pressed={tab === 'spof'}
          className={tabClass(tab === 'spof')}
          onClick={() => setTab(tab === 'spof' ? null : 'spof')}
        >
          <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" /> Single points of failure
        </button>
        {loading && (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Loading" />
        )}
      </div>
      {error && <InlineNotice tone="warning">{error}</InlineNotice>}

      {tab === 'time' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="graph-time-input" className="text-xs">
                View the graph as of
              </Label>
              <Input
                id="graph-time-input"
                type="datetime-local"
                className="h-9 w-56"
                min={min}
                max={max}
                value={picked}
                onChange={event => event.target.value && travel(new Date(event.target.value))}
              />
            </div>
            <Button size="sm" variant="outline" disabled={!at} onClick={() => travel(null)}>
              <Undo2 className="h-4 w-4" aria-hidden="true" /> Back to now
            </Button>
          </div>
          <div className="space-y-1">
            <input
              type="range"
              aria-label="Time, last 90 days"
              aria-valuetext={
                at
                  ? `${at.toLocaleString()}${timeline ? `; ${dayCounts(slider).incidents} incidents opened and ${dayCounts(slider).changes} dependency changes in the day before` : ''}`
                  : 'Now'
              }
              className="w-full accent-primary"
              min={0}
              max={DAYS}
              step={1}
              value={slider}
              onChange={event => {
                const days = Number(event.target.value);
                if (days >= DAYS) travel(null);
                else travel(new Date(Date.now() - (DAYS - days) * DAY_MS));
              }}
            />
            {timeline && (
              <div className="relative h-3" aria-hidden="true" data-testid="timeline-ticks">
                {timeline.incidents.map((count, ago) =>
                  count > 0 && ago < DAYS ? (
                    <span
                      key={`i${ago}`}
                      title={`${count} incident${count === 1 ? '' : 's'} opened`}
                      className="absolute top-0 h-1.5 w-0.5 -translate-x-1/2 rounded-full bg-status-critical"
                      style={{ left: `${((DAYS - ago - 0.5) / DAYS) * 100}%` }}
                    />
                  ) : null
                )}
                {timeline.changes.map((count, ago) =>
                  count > 0 && ago < DAYS ? (
                    <span
                      key={`c${ago}`}
                      title={`${count} dependency change${count === 1 ? '' : 's'}`}
                      className="absolute bottom-0 h-1.5 w-0.5 -translate-x-1/2 rounded-full bg-ink-500"
                      style={{ left: `${((DAYS - ago - 0.5) / DAYS) * 100}%` }}
                    />
                  ) : null
                )}
              </div>
            )}
            <div className="flex justify-between gap-2 text-2xs text-muted-foreground">
              <span>{TIME_TRAVEL_DAYS} days ago</span>
              {timeline && (
                <span className="inline-flex items-center gap-2">
                  <span className="inline-flex items-center gap-1">
                    <span
                      className="h-1.5 w-0.5 rounded-full bg-status-critical"
                      aria-hidden="true"
                    />{' '}
                    incidents
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="h-1.5 w-0.5 rounded-full bg-ink-500" aria-hidden="true" />{' '}
                    changes
                  </span>
                </span>
              )}
              <span>Now</span>
            </div>
          </div>
          <p className="text-2xs text-muted-foreground">
            Dependencies, incidents and statuses are replayed; membership, maintenance windows and
            deleted services are not. Editing is off while you look at the past.
          </p>
        </div>
      )}

      {tab === 'changes' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Since</span>
            <div
              role="group"
              aria-label="Changes since"
              className="inline-flex rounded-md bg-muted p-0.5"
            >
              {SINCE_OPTIONS.map(option => (
                <button
                  key={option.days}
                  type="button"
                  aria-pressed={sinceDays === option.days}
                  className={cn(
                    'h-7 rounded-sm px-2 text-xs font-medium',
                    sinceDays === option.days
                      ? 'bg-background text-foreground shadow-xs'
                      : 'text-ink-600'
                  )}
                  onClick={() => setSinceDays(option.days)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <span className="text-2xs text-muted-foreground">
              Lines marked <span className="font-semibold text-foreground">new</span> were added,{' '}
              faint dashed lines marked{' '}
              <span className="font-semibold text-foreground">removed</span> were removed
            </span>
          </div>
          {diff && (
            <div className="space-y-3 text-sm">
              {diff.truncated && (
                <InlineNotice tone="info">Only part of a large graph was compared.</InlineNotice>
              )}
              {seesSuggestions && diff.awaitingReview.count > 0 && (
                <p>
                  <button type="button" className="font-medium underline" onClick={onShowSuggested}>
                    {diff.awaitingReview.count} suggested{' '}
                    {diff.awaitingReview.count === 1 ? 'dependency is' : 'dependencies are'}{' '}
                    awaiting review
                  </button>
                </p>
              )}
              {total === 0 && (
                <p className="text-muted-foreground">Nothing changed in this period.</p>
              )}
              <EdgeList title="Added" tone="text-foreground" rows={diff.addedDependencies} />
              <EdgeList
                title="Removed"
                tone="text-muted-foreground"
                rows={diff.removedDependencies}
              />
              {seesSuggestions && (
                <EdgeList
                  title="Newly suggested"
                  tone="text-muted-foreground"
                  rows={diff.newlySuggestedDependencies}
                />
              )}
              <StatusList title="Service status changes" rows={diff.serviceStatusChanges} />
              <StatusList
                title="Business service status changes"
                rows={diff.businessServiceStatusChanges}
              />
            </div>
          )}
        </div>
      )}

      {tab === 'spof' && spof && (
        <div className="space-y-2 text-sm">
          {spof.truncated && (
            <InlineNotice tone="info">Only part of a large graph was analysed.</InlineNotice>
          )}
          {spof.singlePointsOfFailure.length === 0 ? (
            <p className="text-muted-foreground">
              No service with {spof.threshold}+ dependents lacks an owner team or on-call.
            </p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                Services that {spof.threshold}+ others depend on and that have no owner team or no
                on-call. They are badged on the graph.
              </p>
              <ul className="divide-y rounded-md border">
                {spof.singlePointsOfFailure.map(row => (
                  <li
                    key={row.serviceId}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{row.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {row.fanOut} dependents · {row.businessServiceCount} business services
                        {row.criticalBusinessServiceCount > 0 &&
                          ` (${row.criticalBusinessServiceCount} critical)`}
                        {row.articulationPoint && ' · cut point'} ·{' '}
                        {row.reasons
                          .map(r => (r === 'NO_OWNER_TEAM' ? 'no owner team' : 'no on-call'))
                          .join(', ')}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onSelectService(row.serviceId)}
                    >
                      Show on graph
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}

type EdgeRow = GraphDiff['addedDependencies'][number];
function EdgeList({
  title,
  tone,
  rows,
}: {
  title: string;
  tone: string;
  rows: readonly EdgeRow[];
}) {
  if (rows.length === 0) return null;
  return (
    <section>
      <h3 className={cn('text-2xs font-semibold uppercase tracking-wide', tone)}>
        {title} <span className="tabular-nums">({rows.length})</span>
      </h3>
      <ul className="mt-1 space-y-0.5 text-xs">
        {rows.slice(0, 20).map(row => (
          <li key={`${row.upstreamServiceId}>${row.downstreamServiceId}`} className="truncate">
            {row.downstreamName ?? 'a service you cannot see'} →{' '}
            {row.upstreamName ?? 'a service you cannot see'}
          </li>
        ))}
      </ul>
      {rows.length > 20 && (
        <p className="text-2xs text-muted-foreground">and {rows.length - 20} more</p>
      )}
    </section>
  );
}

function StatusList({ title, rows }: { title: string; rows: GraphDiff['serviceStatusChanges'] }) {
  if (rows.length === 0) return null;
  return (
    <section>
      <h3 className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title} <span className="tabular-nums">({rows.length})</span>
      </h3>
      <ul className="mt-1 space-y-1 text-xs">
        {rows.slice(0, 20).map(row => (
          <li key={row.id} className="flex flex-wrap items-center gap-1.5">
            <span className="truncate font-medium">{row.name ?? row.id}</span>
            <GraphHealthBadge status={row.from} />
            <span aria-label="became">→</span>
            <GraphHealthBadge status={row.to} />
          </li>
        ))}
      </ul>
    </section>
  );
}
